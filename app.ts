import express from "express"
import { createServer } from "http"
import type { Server, Socket } from "socket.io"
import dotenv from "dotenv"
import { GoogleGenAI } from "@google/genai"
import { initDB, pool } from "./db"

dotenv.config()
const app = express()
const http = createServer(app)
const io: Server = require("socket.io")(http)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "dummy_key" })

app.use(express.static("public"))
initDB().then(() => {
    http.listen(3000, () => {
        console.log("listening on *:3000")
    })
})

interface PlayerData {
    pin: string;
    nickname: string;
    player_id: number;
    score: number;
    attempt_option_id: number | null;
}

interface SessionData {
    session_id: number;
    quiz_id: number;
    host_socket_id: string;
    nextResolver: (() => void) | null;
}

const hostMap: Record<string, string> = {};
const playerMap: Record<string, PlayerData> = {};
const sessionMap: Record<string, SessionData> = {};

io.on("connection", (socket: Socket) => {
    socket.emit("connected");

    socket.on("login", async ({ username, password }) => {
        try {
            const [rows]: any = await pool.query("SELECT user_id, password_hash FROM Users WHERE username=?", [username]);
            if (rows.length > 0 && rows[0].password_hash !== password) {
                return socket.emit("login_error", "Incorrect password");
            } else if (rows.length === 0) {
                await pool.query("INSERT INTO Users (username, email, password_hash) VALUES (?, ?, ?)", [username, username+"@triv.local", password || "pass"]);
            }
            socket.emit("login_success");
        } catch (e) {
            socket.emit("login_error", "Database Interaction failed.");
        }
    });

    socket.on("get_quizzes", async () => {
        const [rows]: any = await pool.query("SELECT * FROM Quizzes");
        socket.emit("quiz_list", rows);
    });

    socket.on("host_quiz", async (quizId) => {
        try {
            const gamePin = Math.floor(1000 + Math.random() * 9000).toString();
            const [res]: any = await pool.query("INSERT INTO Sessions (game_pin, is_active, quiz_id) VALUES (?, true, ?)", [gamePin, quizId]);
            hostMap[socket.id] = gamePin;
            sessionMap[gamePin] = {
                session_id: res.insertId,
                quiz_id: quizId,
                host_socket_id: socket.id,
                nextResolver: null
            };
            socket.join('host_' + gamePin);
            socket.emit("host_lobby", gamePin);
        } catch (e) {
             socket.emit("login_error", "Could not start session.");
        }
    });

    socket.on("verify_pin", async (pin) => {
        if (!sessionMap[pin]) return socket.emit("join_error", "Invalid PIN or session closed.");
        socket.emit("pin_valid", pin);
    });

    socket.on("join_game", async ({ pin, nickname }) => {
        try {
            if (!sessionMap[pin]) return socket.emit("join_error", "Session closed.");
            const session_id = sessionMap[pin].session_id;
            const [res]: any = await pool.query("INSERT INTO Players (nickname, session_id) VALUES (?, ?)", [nickname, session_id]);
            playerMap[socket.id] = { pin, nickname, player_id: res.insertId, score: 0, attempt_option_id: null };
            socket.join('player_' + pin);
            io.to('host_' + pin).emit("player_joined", nickname);
            socket.emit("joined_lobby");
        } catch(e) { socket.emit("join_error", "Failed to join"); }
    });

    socket.on("create_quiz", async (quizData) => {
        try {
            const { title, category, questions } = quizData;
            const [admin]: any = await pool.query("SELECT user_id FROM Users LIMIT 1");
            const userId = admin.length > 0 ? admin[0].user_id : 1;

            const [res1]: any = await pool.query("INSERT INTO Quizzes (title, category, user_id) VALUES (?, ?, ?)", [title, category, userId]);
            const quizId = res1.insertId;
            
            for (const q of questions) {
                if(!q.text) continue;
                const [res2]: any = await pool.query("INSERT INTO Questions (question_text, points, time_limit, quiz_id) VALUES (?, 100, 10, ?)", [q.text, quizId]);
                const qId = res2.insertId;
                for (const opt of q.options) {
                    await pool.query("INSERT INTO Options (option_text, is_correct, question_id) VALUES (?, ?, ?)", [opt.text, opt.is_correct ? 1 : 0, qId]);
                }
            }
            socket.emit("quiz_created_success");
        } catch (e) {
            socket.emit("login_error", "Failed to insert quiz into DB.");
        }
    });

    socket.on("start", async () => {
        const pin = hostMap[socket.id];
        if (!pin || !sessionMap[pin]) return;
        const sessionStore = sessionMap[pin];
        
        try {
            const [questions]: any = await pool.query("SELECT * FROM Questions WHERE quiz_id = ?", [sessionStore.quiz_id]);
            
            for (const question of questions) {
                await new Promise<void>(async (resolve) => {
                    const [options]: any = await pool.query("SELECT * FROM Options WHERE question_id = ?", [question.question_id]);
                    
                    const toSend = {
                        question_id: question.question_id,
                        text: question.question_text,
                        time: question.time_limit || 10,
                        answers: options 
                    };

                    const corr = options.find((o: any) => o.is_correct === 1 || o.is_correct === true);
                    const correctOptionId = corr ? corr.option_id : null;
                    const correctOptionText = corr ? corr.option_text : "No correct option defined!";

                    io.to('player_' + pin).emit("question_player", toSend);
                    io.to('host_' + pin).emit("question_host", toSend);

                    setTimeout(async () => {
                        for (const socketId in playerMap) {
                            const ply = playerMap[socketId];
                            if (ply.pin === pin) {
                                const plySocket = io.sockets.sockets.get(socketId);
                                if (plySocket) {
                                    let resultStatus = "noAnswer";
                                    if (ply.attempt_option_id) {
                                        await pool.query("INSERT INTO Responses (session_id, player_id, question_id, option_id, response_time) VALUES (?, ?, ?, ?, 10)", [sessionStore.session_id, ply.player_id, question.question_id, ply.attempt_option_id]);
                                        if (ply.attempt_option_id === correctOptionId) {
                                            ply.score += 100;
                                            await pool.query("UPDATE Players SET total_score = total_score + 100 WHERE player_id = ?", [ply.player_id]);
                                            resultStatus = "correct";
                                        } else {
                                            resultStatus = "incorrect";
                                        }
                                    }
                                    plySocket.emit("timeUp_player", { status: resultStatus });
                                }
                                if(ply) ply.attempt_option_id = null;
                            }
                        }

                        const playersList = Object.values(playerMap).filter(p => p.pin === pin);
                        const sortedValues = playersList.sort((a, b) => b.score - a.score).map(p => [p.nickname, p.score]);
                        const top5 = sortedValues.slice(0, 5);

                        io.to('host_' + pin).emit("show_answer_host", { correctOptionText, top5 });

                        sessionStore.nextResolver = resolve;
                    }, toSend.time * 1000);
                });
            }
            
            const finalPlayersList = Object.values(playerMap).filter(p => p.pin === pin);
            const finalSorted = finalPlayersList.sort((a, b) => b.score - a.score).map(p => [p.nickname, p.score]);
            
            io.to('player_' + pin).emit("gameover_player");
            io.to('host_' + pin).emit("gameover_host", finalSorted);
            
            await pool.query("UPDATE Sessions SET is_active=false WHERE session_id=?", [sessionStore.session_id]);
            delete sessionMap[pin];
            delete hostMap[socket.id];
            
        } catch(e) { console.error("Game loop error:", e); }
    });

    socket.on("next", () => {
        const pin = hostMap[socket.id];
        if (pin && sessionMap[pin] && sessionMap[pin].nextResolver) {
            sessionMap[pin].nextResolver!();
            sessionMap[pin].nextResolver = null;
        }
    });

    socket.on("answer", (optionId) => {
        if (playerMap[socket.id]) {
            playerMap[socket.id].attempt_option_id = Number(optionId);
        }
    });

    socket.on("ask_hint", async (questionText) => {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: `Hint for: "${questionText}". Do not reveal the exact answer. One sentence.`
            });
            socket.emit("new_hint", response.text);
        } catch (e) {
            socket.emit("new_hint", "AI API Error: Ensure GEMINI_API_KEY is injected.");
        }
    });

    socket.on("disconnect", () => {
        if (hostMap[socket.id]) delete hostMap[socket.id];
        if (playerMap[socket.id]) delete playerMap[socket.id];
    });
});
