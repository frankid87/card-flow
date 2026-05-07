# Requirements Document

## Introduction

Questa feature aggiunge la modalità multiplayer remoto a CardFlow, permettendo a due giocatori autenticati di sfidarsi in tempo reale da dispositivi diversi. Il Giocatore 1 crea una sessione di gioco remota e condivide il link (contenente il `session_id`) con il Giocatore 2. Entrambi si connettono tramite WebSocket al backend FastAPI: ogni mossa viene trasmessa in tempo reale all'avversario, mantenendo il board sincronizzato. Il sistema deve distinguere quale client è `player` (P1) e quale è `opponent` (P2), e garantire che ciascuno possa muovere solo le proprie pedine nel proprio turno.

## Glossary

- **Remote_Session**: Una `GameSession` con `game_mode = "pvp_remote"`, che supporta due connessioni WebSocket simultanee.
- **WebSocket_Manager**: Componente backend che gestisce le connessioni WebSocket attive per sessione e il broadcast degli aggiornamenti.
- **Player_Role**: Il ruolo assegnato a un client connesso: `player` (P1, pedine in basso) o `opponent` (P2, pedine in alto).
- **Session_Link**: URL condivisibile contenente il `session_id`, usato da P2 per unirsi alla partita.
- **Join_Token**: Token opzionale incluso nel Session_Link per autorizzare P2 a unirsi come `opponent`.
- **Board_Update**: Messaggio WebSocket inviato a entrambi i client dopo ogni mossa valida, contenente il nuovo stato completo della sessione.
- **Lobby**: Stato della Remote_Session in cui P1 è connesso ma P2 non si è ancora unito.
- **GameSession**: Modello ORM esistente che rappresenta una partita, con `board_state` JSON e `current_turn`.
- **JWT**: Token di autenticazione già presente nel sistema, usato per identificare l'utente.

---

## Requirements

### Requirement 1: Creazione della sessione remota

**User Story:** Come Giocatore 1, voglio creare una sessione di gioco remota, così da poter invitare un avversario tramite un link condivisibile.

#### Acceptance Criteria

1. WHEN il Giocatore 1 invia una richiesta `POST /game/session` con `game_mode = "pvp_remote"`, THE Session_Manager SHALL creare una `Remote_Session` con `current_turn = "player"` e restituire il `session_id`.
2. THE Session_Manager SHALL accettare `pvp_remote` come valore valido di `game_mode` nel campo `GameModeEnum`.
3. WHEN una `Remote_Session` viene creata, THE Session_Manager SHALL inizializzare il campo `player_user_id` con l'ID dell'utente autenticato che ha effettuato la richiesta.
4. WHEN una `Remote_Session` viene creata, THE Session_Manager SHALL impostare lo stato della sessione a `waiting` (Lobby), indicando che P2 non si è ancora unito.
5. THE Session_Response SHALL includere il `session_id` e il `game_mode` nella risposta, così che il frontend possa costruire il Session_Link.

---

### Requirement 2: Accesso di P2 alla sessione remota

**User Story:** Come Giocatore 2, voglio unirmi a una partita tramite un link condivisibile, così da poter giocare contro P1 da remoto.

#### Acceptance Criteria

1. WHEN il Giocatore 2 invia una richiesta `POST /game/{session_id}/join` con un JWT valido, THE Session_Manager SHALL registrare l'utente come `opponent` nella `Remote_Session`.
2. IF la `Remote_Session` identificata da `session_id` non esiste, THEN THE Session_Manager SHALL restituire HTTP 404.
3. IF la `Remote_Session` ha già un `opponent_user_id` registrato, THEN THE Session_Manager SHALL restituire HTTP 409 (Conflict).
4. IF il Giocatore 2 ha lo stesso `user_id` del Giocatore 1, THEN THE Session_Manager SHALL restituire HTTP 400.
5. WHEN il Giocatore 2 si unisce con successo, THE Session_Manager SHALL aggiornare lo stato della sessione da `waiting` a `ready`.
6. WHEN lo stato della sessione diventa `ready`, THE WebSocket_Manager SHALL notificare P1 tramite il canale WebSocket attivo con un messaggio di tipo `opponent_joined`.

---

### Requirement 3: Connessione WebSocket e assegnazione del ruolo

**User Story:** Come giocatore connesso, voglio ricevere il mio Player_Role tramite WebSocket, così da sapere se controllo le pedine `player` o `opponent`.

#### Acceptance Criteria

1. THE WebSocket_Manager SHALL esporre l'endpoint `WS /game/{session_id}/ws` per le connessioni WebSocket.
2. WHEN un client si connette all'endpoint WebSocket con un JWT valido nel parametro di query `token`, THE WebSocket_Manager SHALL autenticare il client verificando il JWT.
3. IF il JWT non è valido o assente, THEN THE WebSocket_Manager SHALL chiudere la connessione con codice 4001 (Unauthorized).
4. WHEN un client autenticato si connette, THE WebSocket_Manager SHALL inviare un messaggio di tipo `role_assigned` contenente il `Player_Role` (`player` o `opponent`) determinato dal `user_id` nella sessione.
5. IF un terzo client tenta di connettersi a una sessione che ha già due connessioni attive, THEN THE WebSocket_Manager SHALL chiudere la connessione con codice 4003 (Forbidden).
6. WHILE una connessione WebSocket è attiva, THE WebSocket_Manager SHALL mantenere la connessione aperta e rispondere ai messaggi di tipo `ping` con un messaggio di tipo `pong`.

---

### Requirement 4: Sincronizzazione delle mosse in tempo reale

**User Story:** Come giocatore, voglio che la scacchiera si aggiorni in tempo reale dopo ogni mossa dell'avversario, così da poter reagire senza ricaricare la pagina.

#### Acceptance Criteria

1. WHEN un client invia un messaggio WebSocket di tipo `move` con `piece_id` e `to_position`, THE WebSocket_Manager SHALL validare che il `Player_Role` del client corrisponda al `current_turn` della sessione.
2. IF il `Player_Role` del client non corrisponde al `current_turn`, THEN THE WebSocket_Manager SHALL inviare al client un messaggio di tipo `error` con codice `not_your_turn` senza modificare lo stato della sessione.
3. WHEN una mossa è valida, THE Session_Manager SHALL applicare la mossa e persistere il nuovo `board_state` nel database.
4. WHEN il `board_state` viene aggiornato, THE WebSocket_Manager SHALL inviare un `Board_Update` a entrambi i client connessi alla sessione.
5. THE Board_Update SHALL contenere l'intero stato della sessione: `board_state`, `current_turn`, `winner` e `game_mode`.
6. IF la mossa è invalida secondo le regole del gioco, THEN THE WebSocket_Manager SHALL inviare al client un messaggio di tipo `error` con il dettaglio dell'errore, senza modificare lo stato della sessione.

---

### Requirement 5: Gestione della disconnessione

**User Story:** Come giocatore, voglio che il sistema gestisca le disconnessioni in modo prevedibile, così da non perdere lo stato della partita in caso di problemi di rete temporanei.

#### Acceptance Criteria

1. WHEN un client WebSocket si disconnette, THE WebSocket_Manager SHALL rimuovere la connessione dal registro delle connessioni attive per quella sessione.
2. WHEN un client si disconnette durante una partita in corso, THE WebSocket_Manager SHALL inviare all'altro client connesso un messaggio di tipo `opponent_disconnected`.
3. WHILE un client è disconnesso, THE Session_Manager SHALL mantenere il `board_state` persistito nel database invariato.
4. WHEN il client disconnesso si riconnette entro 60 secondi, THE WebSocket_Manager SHALL ripristinare la connessione e inviare il `Board_Update` con lo stato corrente della sessione.
5. IF il client disconnesso non si riconnette entro 60 secondi, THEN THE Session_Manager SHALL impostare `winner` al `Player_Role` del client ancora connesso e inviare un `Board_Update` finale a quest'ultimo.

---

### Requirement 6: Visualizzazione del Session_Link nel frontend

**User Story:** Come Giocatore 1, voglio vedere e copiare il link di invito dopo aver creato la sessione, così da poterlo condividere facilmente con l'avversario.

#### Acceptance Criteria

1. WHEN la `Remote_Session` viene creata con successo, THE Frontend SHALL visualizzare il Session_Link nella forma `{base_url}/game/remote/{session_id}`.
2. THE Frontend SHALL fornire un pulsante "Copia link" che copia il Session_Link negli appunti del browser.
3. WHILE lo stato della sessione è `waiting`, THE Frontend SHALL mostrare un indicatore visivo che P2 non si è ancora unito (es. "In attesa dell'avversario…").
4. WHEN il messaggio `opponent_joined` viene ricevuto via WebSocket, THE Frontend SHALL rimuovere l'indicatore di attesa e mostrare la scacchiera interattiva.

---

### Requirement 7: Identificazione del ruolo nel frontend

**User Story:** Come giocatore remoto, voglio che l'interfaccia mi mostri chiaramente quale lato della scacchiera controllo, così da non confondermi con l'avversario.

#### Acceptance Criteria

1. WHEN il messaggio `role_assigned` viene ricevuto via WebSocket, THE Frontend SHALL memorizzare il `Player_Role` per tutta la durata della sessione.
2. WHILE il `Player_Role` è `player`, THE Frontend SHALL permettere l'interazione solo con le pedine il cui campo `owner` è `"player"`.
3. WHILE il `Player_Role` è `opponent`, THE Frontend SHALL permettere l'interazione solo con le pedine il cui campo `owner` è `"opponent"`.
4. WHILE non è il turno del client locale (il `current_turn` non corrisponde al `Player_Role`), THE Frontend SHALL disabilitare l'interazione con la scacchiera e mostrare "In attesa della mossa avversaria…".
5. THE Frontend SHALL etichettare visivamente le pedine del client locale come "Le tue pedine" e quelle dell'avversario come "Pedine avversario".

---

### Requirement 8: Persistenza e recupero dello stato di sessione

**User Story:** Come giocatore, voglio poter ricaricare la pagina e ritrovare la partita nello stato corrente, così da non perdere la partita in caso di refresh accidentale.

#### Acceptance Criteria

1. WHEN un client naviga verso `{base_url}/game/remote/{session_id}`, THE Frontend SHALL recuperare lo stato corrente della sessione tramite `GET /game/{session_id}` prima di stabilire la connessione WebSocket.
2. WHEN la connessione WebSocket viene stabilita dopo un refresh, THE WebSocket_Manager SHALL inviare immediatamente un `Board_Update` con lo stato corrente al client riconnesso.
3. THE GameSession SHALL persistere il `board_state` nel database dopo ogni mossa, garantendo che lo stato sia recuperabile in qualsiasi momento.
4. IF la sessione ha già un `winner` al momento della connessione, THEN THE Frontend SHALL mostrare il risultato finale senza abilitare ulteriori mosse.
