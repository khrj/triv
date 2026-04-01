# Socket.IO Event Architecture (Triv)

The Triv backend leverages a strict Room-based Socket.IO architecture separating Hosts from Players and integrating natively with the MySQL schema. Below is the mapping of all events controlling the application state.

---

## 1. Authentication & Initialization

*   **`connected` (Server -> Client)**
    *   Emitted automatically on connection. Triggers the SweetAlert (SWAL) Login UI.
*   **`login` (Client -> Server)**
    *   **Payload**: `{ username, password }`
    *   Queries `Users` table and initiates password check, or registers implicitly if missing.
*   **`login_error` / `login_success` (Server -> Client)**
    *   Responds dynamically redirecting to the Main Menu Dashboard upon success.

---

## 2. Dashboard & Quiz Assembly

*   **`get_quizzes` (Client -> Server)**
    *   Client invokes the list of all playable Trivia environments.
*   **`quiz_list` (Server -> Client)**
    *   Returns array of `Quizzes` table payload driving the Select Hub.
*   **`create_quiz` (Client -> Server)**
    *   **Payload**: `{ title, category, questions: [...] }`
    *   Recursively parses standard options resolving DB locks in `Quizzes`, `Questions`, and `Options`.
*   **`quiz_created_success` (Server -> Client)**
    *   Acknowledges SQL Commit success back to the creator pipeline.

---

## 3. Hosting a Game (Screen Logic)

*   **`host_quiz` (Client -> Server)**
    *   **Payload**: `quizId`
    *   Host binds to a generated PIN traversing `socket.join('host_' + pin)`. Creates active row in `Sessions`.
*   **`host_lobby` (Server -> Client)**
    *   Sends the physical `sessionId` (game PIN) prompting the Host screen to begin observing `player_joined` events.
*   **`start` (Host -> Server)**
    *   Triggered when the Host closes the Lobby. Server invokes the async loop grabbing `Questions` and enforcing internal `setTimeout` clocks.
*   **`next` (Host -> Server)**
    *   Resolves the intermediate Promise loop locking the Leaderboard transition, effectively moving the room to the next question.

---

## 4. Joining a Game (Player Logic)

*   **`verify_pin` (Client -> Server)**
    *   Before gathering Nicknames, checks if the requested PIN exists inside local Memory mapped to `Sessions`.
*   **`pin_valid` / `join_error` (Server -> Client)**
    *   Unlocks or blocks the pipeline based on Session validity.
*   **`join_game` (Client -> Server)**
    *   **Payload**: `{ pin, nickname }`
    *   Inserts the player to `Players`, allocating points=0 tracking data. Joins `socket.join('player_' + pin)`.
*   **`player_joined` (Server -> Host)**
    *   Dispatches raw Nickname to active Host pushing them into the lobby grid immediately.
*   **`joined_lobby` (Server -> Client)**
    *   Locks internal SweetAlert confirming registration to the user seamlessly.

---

## 5. Active Game Loop (The Engine)

### **The Question Payload**
*   **`question_host` (Server -> Host)**
    *   Delivers Question Text and Time Limit formatting the 48px Ticker overlay.
*   **`question_player` (Server -> Player)**
    *   Delivers Question Text, Time Limit, and the Answer `option_id` array generating the 2x2 clickable standard Kahoot color grid buttons.

### **Answering Data**
*   **`ask_hint` (Client -> Server)**
    *   Player demands assistance querying `@google/genai`.
*   **`new_hint` (Server -> Client)**
    *   Streams the Gemini prompt exclusively back to the requesting Player's SWAL instance.
*   **`answer` (Client -> Server)**
    *   **Payload**: `optionId: string`
    *   Parses to Integer assigning memory array flags ensuring the DB resolves the correct Attempt.

### **Time Up Evaluation**
*   **`timeUp_player` (Server -> Player)**
    *   **Payload**: `{ status: "correct" | "incorrect" | "noAnswer" }`
    *   The Server queries all options verifying score increments writing directly to `Responses` & `Players` totals prior to issuing this feedback directly causing individual Success/Error popups.
*   **`show_answer_host` (Server -> Host)**
    *   Dispatches the `correctOptionText` overriding the Question interface gracefully. This flows straight into the `top5` array resolving the live Scoreboard Screen natively.

### **Termination**
*   **`gameover_host` (Server -> Host)**
    *   Sends complete sorted output wiping memory arrays natively and updating `Sessions` to `is_active=false`.
*   **`gameover_player` (Server -> Player)**
    *   Simple notification clearing screen tracking variables enforcing user disconnect.
