const socket = io();

// Login Flow
socket.on("connected", () => {
    showLogin();
});

async function showLogin() {
    const u = await swal("Login / Register", "Enter Username:", { content: "input", closeOnClickOutside: false, closeOnEsc: false });
    if (!u) return showLogin();
    const p = await swal("Login / Register", "Enter Password:", { content: { element: "input", attributes: { type: "password" } }, closeOnClickOutside: false, closeOnEsc: false });
    if (!p) return showLogin();
    socket.emit("login", { username: u, password: p });
}

socket.on("login_error", msg => { swal("Error", msg, "error").then(showLogin); });
socket.on("login_success", () => { showMenu(); });

function showMenu() {
    swal("Triv Dashboard", "Select an action:", {
        buttons: {
            join: { text: "Join Game (Player)", value: "join" },
            host: { text: "Host Game (Screen)", value: "host" },
            create: { text: "Create Quiz", value: "create" }
        },
        closeOnClickOutside: false,
        closeOnEsc: false
    }).then(action => {
        if (action === "join") {
            swal("Enter Game PIN:", { content: "input", closeOnClickOutside: false }).then(pin => {
                if(pin) socket.emit("verify_pin", pin);
                else showMenu();
            });
        } else if (action === "host") {
            socket.emit("get_quizzes");
        } else if (action === "create") {
            showCreateQuiz();
        }
    });
}

socket.on("pin_valid", async (pin) => {
    const nickname = await swal("Your Nickname:", { content: "input", closeOnClickOutside: false });
    if(nickname) socket.emit("join_game", { pin, nickname });
    else showMenu();
});

socket.on("join_error", msg => { swal("Error", msg, "error").then(showMenu); });

socket.on("quiz_list", (quizzes) => {
    let buttons = { cancel: "Cancel" };
    quizzes.forEach(q => { buttons["quiz_" + q.quiz_id] = { text: q.title, value: q.quiz_id }; });
    
    swal("Select Quiz to Host", "Choose one from the DB:", { buttons, closeOnClickOutside: false })
      .then(val => { 
          if (!val || val === "cancel") return showMenu();
          socket.emit("host_quiz", val);
      });
});

socket.on("host_lobby", (sessionId) => {
    let players = [];
    swal(`Lobby PIN: ${sessionId}`, `Players joined: 0`, { button: "Start Game", closeOnClickOutside: false })
     .then(() => {
          socket.emit("start");
          swal("Game Running", "Look at the big screen", "info", { buttons: false, closeOnClickOutside: false });
     });
     
    socket.on("player_joined", name => {
        players.push(name);
        swal(`Lobby PIN: ${sessionId}`, `Players joined: ${players.join(", ")}`, { button: "Start Game", closeOnClickOutside: false })
         .then(() => {
            socket.emit("start");
            swal("Game Running", "Look at the big screen", "info", { buttons: false, closeOnClickOutside: false });
         });
    });
});

socket.on("joined_lobby", () => {
    swal("Joined!", "You're in! Look at the host screen.", "success", { buttons: false, closeOnClickOutside: false });
});

// CREATE QUIZ BUILDER IN NATIVE SWAL
async function showCreateQuiz() {
    const title = await swal("Quiz Title:", { content: "input", closeOnClickOutside: false });
    if (!title) return showMenu();
    const category = await swal("Category:", { content: "input", closeOnClickOutside: false });
    if (!category) return showMenu();
    
    let questions = [];
    let addMore = true;
    while(addMore) {
        const text = await swal(`Q${questions.length + 1}: Question Text`, { content: "input", closeOnClickOutside: false });
        if(!text) break;
        const opt1 = await swal("Correct Option:", { content: "input", closeOnClickOutside: false });
        const opt2 = await swal("Wrong Option 1:", { content: "input", closeOnClickOutside: false });
        const opt3 = await swal("Wrong Option 2:", { content: "input", closeOnClickOutside: false });
        const opt4 = await swal("Wrong Option 3:", { content: "input", closeOnClickOutside: false });
        
        questions.push({
            text, options: [
                { text: opt1 || "True", is_correct: true },
                { text: opt2 || "False", is_correct: false },
                { text: opt3 || "-", is_correct: false },
                { text: opt4 || "-", is_correct: false }
            ]
        });
        
        const nextStep = await swal("Question Added!", "Add another question?", { buttons: { finish: "Finish", more: "Add More" }, closeOnClickOutside: false });
        addMore = (nextStep === "more");
    }
    
    socket.emit("create_quiz", { title, category, questions });
    swal("Saving...", { buttons: false });
}

socket.on("quiz_created_success", () => { swal("Success", "Quiz Published to Database!", "success").then(showMenu); });

// IN-GAME PLAY - HOST
socket.on("question_host", (question) => {
    let timeLeft = question.time;
    let contentDiv = document.createElement("div");
    contentDiv.innerHTML = `
        <div style="font-size: 48px; font-weight: bold; margin-bottom: 30px;">${question.text}</div>
        <div style="font-size: 20px; color: #777;">Time remaining: <span id="timeSecs" style="font-weight:bold;">${timeLeft}</span>s</div>
    `;
    swal({ content: contentDiv, buttons: false, closeOnClickOutside: false, className: "swal-wide" });
    
    let timerInterval = setInterval(() => {
        timeLeft--;
        const spn = document.getElementById("timeSecs");
        if (spn) spn.innerText = timeLeft;
        if (timeLeft <= 0) clearInterval(timerInterval);
    }, 1000);
});

// IN-GAME PLAY - PLAYER
socket.on("question_player", (question) => {
    const contentDiv = document.createElement("div");
    let html = `<div style="margin-bottom: 20px; font-size: 24px; font-weight:bold;">${question.text}</div>`;
    html += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom: 20px;">`;
    const colors = ["#E21B3C", "#1368CE", "#D89E00", "#26890C"];
    question.answers.forEach((opt, idx) => {
        if(opt.option_text.trim() !== "") {
            const color = colors[idx % 4];
            html += `<button class="kahoot-btn" data-val="${opt.option_id}" style="padding:30px 10px; font-size:20px; font-weight:bold; color:white; background:${color}; border:none; border-radius:5px; cursor:pointer;">${opt.option_text}</button>`;
        }
    });
    html += `</div>`;
    html += `<button id="hintBtn" style="padding: 10px 15px; background: #FF416C; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">💡 Ask AI for Hint</button>`;
    html += `<div id="hintText" style="margin-top: 15px; font-style: italic; color: #555;"></div>`;
    contentDiv.innerHTML = html;

    swal({
        content: contentDiv,
        buttons: false,
        className: "swal-wide",
        closeOnClickOutside: false,
        closeOnEsc: false,
    });

    const hintBtn = contentDiv.querySelector("#hintBtn");
    hintBtn.addEventListener("click", () => {
        hintBtn.innerText = "Generating...";
        socket.emit("ask_hint", question.text);
    });
    
    socket.on("new_hint", (hint) => {
        const hText = contentDiv.querySelector("#hintText");
        if (hText) hText.innerText = `💡 ${hint}`;
        if (hintBtn) hintBtn.innerText = "Hint Generated";
    });

    const btns = contentDiv.querySelectorAll(".kahoot-btn");
    btns.forEach(btn => {
        btn.onclick = () => {
            socket.off("new_hint");
            socket.emit("answer", btn.getAttribute("data-val"));
            swal("Answer Locked", "Look at the main screen!", "success", { buttons: false, closeOnClickOutside: false });
        };
    });
});

socket.on("timeUp_player", (data) => {
    let title, text, icon;
    if(data.status === "correct") { title = "Correct!"; text = "+100 Points. Look at the host screen."; icon = "success"; }
    else if(data.status === "incorrect") { title = "Incorrect!"; text = "Better luck next time. Look at the host screen."; icon = "error"; }
    else { title = "Time's Up!"; text = "You didn't answer! Look at the host screen."; icon = "warning"; }
    
    swal(title, text, icon, { buttons: false, closeOnClickOutside: false });
});

socket.on("show_answer_host", (data) => {
    swal("Correct Answer was:", data.correctOptionText, "success", { button: "Show Leaderboard", closeOnClickOutside: false })
     .then(() => {
        let text = data.top5.map(p => `${p[0]}: ${p[1]}`).join("\n");
        swal("Leader Board", text, "info", { button: "Next Question", closeOnClickOutside: false })
         .then(() => {
            socket.emit("next");
            swal("Loading...", { buttons: false, closeOnClickOutside: false });
         });
     });
});

socket.on("gameover_host", (leaderboard) => {
    let text = leaderboard.map(p => `🏆 ${p[0]}: ${p[1]}`).join("\n");
    swal("Game over!", text, "success", { button: "Return to Menu", closeOnClickOutside: false })
     .then(() => {
         socket.off("player_joined");
         showMenu();
     });
});

socket.on("gameover_player", () => {
    swal("Game over!", "Look at the Host Screen!", "success", { button: "Return to Menu", closeOnClickOutside: false })
     .then(() => {
         showMenu();
     });
});
