import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

export let pool: mysql.Pool;

export async function initDB() {
    let retries = 5;
    while (retries > 0) {
        try {
            pool = mysql.createPool(process.env.MYSQL_URL || "mysql://root:password@db:3306/triv");
            const connection = await pool.getConnection();
            
            await connection.query(`
                CREATE TABLE IF NOT EXISTS Users (
                    user_id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL UNIQUE,
                    email VARCHAR(255) NOT NULL,
                    password_hash VARCHAR(255) NOT NULL
                )
            `);
            await connection.query(`
                CREATE TABLE IF NOT EXISTS Quizzes (
                    quiz_id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    category VARCHAR(255),
                    created_on DATETIME DEFAULT CURRENT_TIMESTAMP,
                    user_id INT,
                    FOREIGN KEY (user_id) REFERENCES Users(user_id)
                )
            `);
            await connection.query(`
                CREATE TABLE IF NOT EXISTS Sessions (
                    session_id INT AUTO_INCREMENT PRIMARY KEY,
                    game_pin VARCHAR(255),
                    is_active BOOLEAN DEFAULT false,
                    quiz_id INT,
                    FOREIGN KEY (quiz_id) REFERENCES Quizzes(quiz_id)
                )
            `);
            await connection.query(`
                CREATE TABLE IF NOT EXISTS Players (
                    player_id INT AUTO_INCREMENT PRIMARY KEY,
                    nickname VARCHAR(255),
                    total_score INT DEFAULT 0,
                    session_id INT,
                    FOREIGN KEY (session_id) REFERENCES Sessions(session_id)
                )
            `);
            await connection.query(`
                CREATE TABLE IF NOT EXISTS Questions (
                    question_id INT AUTO_INCREMENT PRIMARY KEY,
                    question_text VARCHAR(255),
                    points INT,
                    time_limit INT,
                    quiz_id INT,
                    FOREIGN KEY (quiz_id) REFERENCES Quizzes(quiz_id)
                )
            `);
            await connection.query(`
                CREATE TABLE IF NOT EXISTS Options (
                    option_id INT AUTO_INCREMENT PRIMARY KEY,
                    option_text VARCHAR(255),
                    is_correct BOOLEAN,
                    question_id INT,
                    FOREIGN KEY (question_id) REFERENCES Questions(question_id)
                )
            `);
            await connection.query(`
                CREATE TABLE IF NOT EXISTS Responses (
                    response_id INT AUTO_INCREMENT PRIMARY KEY,
                    response_time INT,
                    session_id INT,
                    player_id INT,
                    question_id INT,
                    option_id INT,
                    FOREIGN KEY (session_id) REFERENCES Sessions(session_id),
                    FOREIGN KEY (player_id) REFERENCES Players(player_id),
                    FOREIGN KEY (question_id) REFERENCES Questions(question_id),
                    FOREIGN KEY (option_id) REFERENCES Options(option_id)
                )
            `);
            
            // Roles Creation
            try {
                // Must catch errors if running without broad root privs recursively
                await connection.query("CREATE USER IF NOT EXISTS 'dba_user'@'%' IDENTIFIED BY 'dbapass';");
                await connection.query("GRANT ALL PRIVILEGES ON triv.* TO 'dba_user'@'%';");
                
                await connection.query("CREATE USER IF NOT EXISTS 'view_only_user'@'%' IDENTIFIED BY 'viewpass';");
                await connection.query("GRANT SELECT ON triv.* TO 'view_only_user'@'%';");
                
                await connection.query("CREATE USER IF NOT EXISTS 'editor_user'@'%' IDENTIFIED BY 'editorpass';");
                await connection.query("GRANT SELECT, UPDATE ON triv.* TO 'editor_user'@'%';");
                
                await connection.query("FLUSH PRIVILEGES;");

                // Seed Example Quiz
                const [admins]: any = await connection.query("SELECT * FROM Users WHERE username = 'admin'");
                if (admins.length === 0) {
                    await connection.query("INSERT INTO Users (username, email, password_hash) VALUES ('admin', 'admin@triv.local', 'password')");
                    const [adminRows]: any = await connection.query("SELECT user_id FROM Users WHERE username = 'admin'");
                    const adminId = adminRows[0].user_id;

                    await connection.query("INSERT INTO Quizzes (title, category, user_id) VALUES ('New Year Trivia Seed', 'Holiday', ?)", [adminId]);
                    const [quizRows]: any = await connection.query("SELECT quiz_id FROM Quizzes ORDER BY created_on DESC LIMIT 1");
                    const quizId = quizRows[0].quiz_id;

                    const seedQuestions = [
                        { text: "In Spain, people eat 12 ____ right before midnight.", time: 10, points: 100, options: [{text: "olives", is: false}, {text: "tapas", is: false}, {text:"grapes", is: true}, {text: "bread", is: false}] },
                        { text: "Which country calls New Year's Eve Hogmanay?", time: 10, points: 100, options: [{text: "Ireland", is: false}, {text: "Scotland", is: true}, {text: "England", is: false}, {text: "Finland", is: false}] },
                    ];

                    for (const q of seedQuestions) {
                        await connection.query("INSERT INTO Questions (question_text, time_limit, points, quiz_id) VALUES (?, ?, ?, ?)", [q.text, q.time, q.points, quizId]);
                        const [qRows]: any = await connection.query("SELECT question_id FROM Questions ORDER BY question_id DESC LIMIT 1");
                        const qId = qRows[0].question_id;

                        for (const opt of q.options) {
                            await connection.query("INSERT INTO Options (option_text, is_correct, question_id) VALUES (?, ?, ?)", [opt.text, opt.is, qId]);
                        }
                    }
                }
            } catch (e) {
                console.log("Initialization issue (safe to ignore if not root):", e);
            }

            connection.release();
            console.log("Connected to MySQL successfully and initialized ER schema mappings.");
            break;
        } catch (error: any) {
            console.log("DB Connection Failed, retrying in 5s...", error.message);
            retries -= 1;
            await new Promise(res => setTimeout(res, 5000));
            if (retries === 0) {
                console.error("FATAL: Could not connect to MySQL");
                process.exit(1);
            }
        }
    }
}
