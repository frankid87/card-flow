# Piano di Implementazione: Remote Multiplayer

## Overview

Aggiunge la modalità `pvp_remote` a CardFlow: estensione del modello `GameSession`, endpoint REST per join, WebSocket manager backend, e nuova pagina frontend per la partita remota con sincronizzazione in tempo reale.

## Tasks

- [x] 1. Estendere il modello dati e gli schema per `pvp_remote`
  - [x] 1.1 Aggiungere `pvp_remote` a `GameModeEnum` in `backend/app/schemas.py`
    - Aggiungere il valore `pvp_remote = "pvp_remote"` all'enum
    - _Requirements: 1.2_
  - [x] 1.2 Aggiungere colonne `player_user_id`, `opponent_user_id` e `status` al modello `GameSession` in `backend/app/models.py`
    - `player_user_id: Optional[str]`, `opponent_user_id: Optional[str]`, `status: str = "local"` (valori: `"local"`, `"waiting"`, `"ready"`)
    - _Requirements: 1.3, 1.4, 2.5_
  - [x] 1.3 Aggiornare `SessionResponse` in `backend/app/schemas.py` per includere `status` e `player_user_id`
    - Aggiungere `status: Optional[str] = None` e `player_user_id: Optional[str] = None`
    - _Requirements: 1.5_
  - [x] 1.4 Aggiornare `SessionCreateRequest` per accettare `game_mode: GameModeEnum` con il nuovo valore `pvp_remote`
    - Nessuna modifica strutturale necessaria, solo verificare che la validazione Pydantic accetti il nuovo enum
    - _Requirements: 1.1, 1.2_

- [x] 2. Aggiornare `session_manager` per la creazione di sessioni remote
  - [x] 2.1 Modificare `create_session` in `backend/app/services/session_manager.py` per gestire `pvp_remote`
    - Se `game_mode == "pvp_remote"`: impostare `status = "waiting"`, `player_user_id` dall'utente autenticato, `opponent_piece_ids` può essere vuota (P2 non ancora connesso)
    - _Requirements: 1.1, 1.3, 1.4_
  - [x] 2.2 Aggiornare `_to_session_response` in `backend/app/routers/game.py` per mappare i nuovi campi `status` e `player_user_id`
    - _Requirements: 1.5_

- [x] 3. Implementare l'endpoint `POST /game/{session_id}/join`
  - [x] 3.1 Creare la funzione `join_session` in `backend/app/services/session_manager.py`
    - Recuperare la sessione; restituire 404 se non esiste
    - Restituire 409 se `opponent_user_id` è già impostato
    - Restituire 400 se `user_id` di P2 coincide con `player_user_id`
    - Impostare `opponent_user_id` e `status = "ready"`, persistere
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 3.2 Aggiungere il route `POST /game/{session_id}/join` in `backend/app/routers/game.py`
    - Richiede JWT valido; chiama `join_session`; restituisce `SessionResponse`
    - _Requirements: 2.1_

- [x] 4. Implementare il `WebSocketManager` backend
  - [x] 4.1 Creare `backend/app/services/websocket_manager.py` con la classe `WebSocketManager`
    - Struttura dati: `dict[session_id, dict[role, WebSocket]]` per le connessioni attive
    - Metodi: `connect`, `disconnect`, `broadcast`, `send_to_role`
    - _Requirements: 3.1, 3.6_
  - [x] 4.2 Aggiungere l'endpoint WebSocket `WS /game/{session_id}/ws` in `backend/app/routers/game.py`
    - Autenticare il client tramite query param `token` (JWT); chiudere con codice 4001 se non valido
    - Determinare il `Player_Role` confrontando `user_id` con `player_user_id` / `opponent_user_id`
    - Rifiutare con codice 4003 se la sessione ha già due connessioni attive
    - Inviare messaggio `role_assigned` al client appena connesso
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 4.3 Implementare il loop di ricezione messaggi nel WebSocket handler
    - Gestire messaggi di tipo `ping` → rispondere con `pong`
    - Gestire messaggi di tipo `move`: validare turno, applicare mossa, fare broadcast del `Board_Update`
    - Gestire messaggi invalidi con risposta `error`
    - _Requirements: 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 4.4 Scrivere unit test per `WebSocketManager` (connect/disconnect/broadcast)
    - Testare che `connect` rifiuti una terza connessione
    - Testare che `broadcast` invii a entrambi i client
    - _Requirements: 3.5_

- [x] 5. Gestione della disconnessione e timeout
  - [x] 5.1 Implementare la logica di disconnessione in `WebSocketManager`
    - Al disconnect: rimuovere dal registro, notificare l'altro client con `opponent_disconnected`
    - _Requirements: 5.1, 5.2_
  - [x] 5.2 Implementare il timer di riconnessione (60 secondi) in `WebSocketManager`
    - Usare `asyncio.create_task` per avviare un timer al disconnect
    - Se il client si riconnette entro 60s: cancellare il timer, inviare `Board_Update` con stato corrente
    - Se scade: impostare `winner` al ruolo del client ancora connesso, inviare `Board_Update` finale
    - _Requirements: 5.3, 5.4, 5.5_
  - [x] 5.3 Notificare P1 con `opponent_joined` quando P2 si unisce con successo
    - Chiamare `websocket_manager.send_to_role(session_id, "player", {"type": "opponent_joined"})` alla fine di `join_session` (o nel router)
    - _Requirements: 2.6_

- [x] 6. Checkpoint — Verificare che tutti i test backend passino
  - Assicurarsi che tutti i test esistenti passino e che i nuovi endpoint rispondano correttamente. Chiedere all'utente se sorgono dubbi.

- [x] 7. Aggiornare i tipi TypeScript nel frontend
  - [x] 7.1 Aggiornare `SessionResponse` in `frontend/types/index.ts`
    - Aggiungere `status?: string` e `player_user_id?: string`
    - Aggiungere `"pvp_remote"` al tipo `game_mode`
    - _Requirements: 1.5, 6.1_
  - [x] 7.2 Aggiungere i tipi per i messaggi WebSocket in `frontend/types/index.ts`
    - `WsRoleAssigned`, `WsBoardUpdate`, `WsError`, `WsOpponentJoined`, `WsOpponentDisconnected`, `WsMoveMessage`
    - _Requirements: 3.4, 4.4, 4.5, 5.2_

- [x] 8. Creare la pagina frontend per la creazione della sessione remota
  - [x] 8.1 Aggiungere l'opzione `pvp_remote` nella schermata di setup in `frontend/app/game/page.tsx`
    - Aggiungere il pulsante "Multiplayer Remoto" accanto a "Player vs Player" e "Player vs Computer"
    - _Requirements: 6.1_
  - [x] 8.2 Dopo la creazione di una sessione `pvp_remote`, mostrare il `Session_Link` e il pulsante "Copia link"
    - Costruire il link come `{window.location.origin}/game/remote/{session_id}`
    - Usare `navigator.clipboard.writeText` per il pulsante "Copia link"
    - Mostrare l'indicatore "In attesa dell'avversario…" mentre `status === "waiting"`
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 9. Creare la pagina frontend per la partita remota
  - [x] 9.1 Creare `frontend/app/game/remote/[sessionId]/page.tsx`
    - Al mount: chiamare `GET /game/{session_id}` per recuperare lo stato corrente
    - Se la sessione ha già un `winner`, mostrare il risultato finale senza abilitare mosse
    - _Requirements: 8.1, 8.4_
  - [x] 9.2 Implementare il hook `useRemoteGame` (o logica inline) per la connessione WebSocket
    - Aprire `WS /game/{session_id}/ws?token={jwt}` al mount
    - Gestire i messaggi: `role_assigned`, `board_update`, `opponent_joined`, `opponent_disconnected`, `error`
    - Memorizzare il `Player_Role` ricevuto da `role_assigned`
    - _Requirements: 3.2, 3.4, 7.1, 8.2_
  - [x] 9.3 Integrare il componente `Board` nella pagina remota con i vincoli di ruolo
    - Passare al `Board` un prop `localRole` per filtrare le interazioni
    - Disabilitare l'interazione quando `current_turn !== localRole` e mostrare "In attesa della mossa avversaria…"
    - _Requirements: 7.2, 7.3, 7.4_
  - [x] 9.4 Inviare le mosse tramite WebSocket invece di HTTP nella pagina remota
    - Intercettare il click su una casella valida e inviare `{"type": "move", "piece_id": "...", "to_position": [...]}` via WebSocket
    - Aggiornare lo stato locale al ricevimento del `Board_Update`
    - _Requirements: 4.1, 4.3, 4.4_
  - [x] 9.5 Gestire la visualizzazione dello stato di disconnessione dell'avversario
    - Al ricevimento di `opponent_disconnected`: mostrare banner "Avversario disconnesso, in attesa di riconnessione…"
    - Rimuovere il banner al ricevimento del successivo `Board_Update`
    - _Requirements: 5.2_
  - [x] 9.6 Scrivere test per il componente della pagina remota
    - Testare che il ruolo venga memorizzato correttamente da `role_assigned`
    - Testare che l'interazione sia disabilitata quando non è il turno locale
    - _Requirements: 7.1, 7.4_

- [x] 10. Aggiungere etichette visive per le pedine nel frontend
  - [x] 10.1 Aggiornare `Board.tsx` per mostrare "Le tue pedine" / "Pedine avversario" quando `localRole` è fornito
    - Aggiungere prop opzionale `localRole?: "player" | "opponent"` al componente `Board`
    - Mostrare l'etichetta nel pannello stats e/o come tooltip sulle pedine
    - _Requirements: 7.5_

- [x] 11. Checkpoint finale — Verificare che tutti i test passino
  - Assicurarsi che tutti i test backend e frontend passino. Chiedere all'utente se sorgono dubbi.

- [x] 12. Aggiungere la modalità AI con difficoltà selezionabile
  - [x] 12.1 Aggiungere `DifficultyEnum` e il campo `difficulty` al modello e agli schema
  - [x] 12.2 Aggiornare `minimax.py` / `session_manager.py` per rispettare la difficoltà
  - [x] 12.3 Aggiornare il frontend per la selezione della difficoltà
  - [x] 12.4 Scrivere test backend per i tre livelli di difficoltà
  - [x] 12.5 Checkpoint — verificare che tutti i test passino

## Note

- I task contrassegnati con `*` sono opzionali e possono essere saltati per un MVP più rapido
- Ogni task fa riferimento ai requisiti specifici per la tracciabilità
- Il design non include una sezione "Correctness Properties", quindi non sono stati aggiunti property-based test
- I checkpoint garantiscono la validazione incrementale
