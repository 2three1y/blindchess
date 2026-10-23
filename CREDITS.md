## Credits
Built only from repos starred by 2three1y, plus one library that the starred chess projects depend on. Each one is listed below with its license and what it does here.

### jesterui
- Repo: https://github.com/jesterui/jesterui
- Author: tbk
- License: MIT
- Starred: yes, checked Oct 23, 2026
- Used for: the chess-over-Nostr message format (kind 30 start and move events with the full move history). Blind Chess games use the same format. No code copied; the format was re-implemented.
- Notice: Copyright (c) 2022 tbk. Full text in licenses/jesterui.txt

### nostr-tools
- Repo: https://github.com/nbd-wtf/nostr-tools
- Author: fiatjaf and contributors (nbd-wtf)
- License: Unlicense
- Starred: yes, checked Oct 23, 2026
- Used for: keys, signing, relay connections and invite links (nevent). Vendored as js/vendor/nostr.bundle.js, version 2.25.2.
- Notice: Public domain; credited anyway. The bundle includes Paul Miller's noble and scure crypto libraries (MIT), see licenses/noble-scure.txt

### soundcn (Kenney Interface Sounds)
- Repo: https://github.com/kapishdima/soundcn
- Author: kapishdima; sounds by Kenney (kenney.nl)
- License: MIT (code, not used); CC0 (the Kenney sounds used)
- Starred: yes, checked Oct 23, 2026
- Used for: the move, capture, check, your-turn, error, start and end sounds, converted from Ogg to MP3 so iPhones play them.
- Notice: Sounds are CC0 by Kenney. soundcn: Copyright (c) 2026 KapishDima. Full texts in licenses/

### chess.js
- Repo: https://github.com/jhlywa/chess.js
- Author: Jeff Hlywa
- License: BSD-2-Clause
- Starred: no. It is not in the starred list. It is the rules library that both starred chess projects (jesterui and hzrd149/chessnut) depend on, so it comes in through them.
- Used for: chess rules: legal moves, check, checkmate, draws and notation. Vendored as js/vendor/chess.js, version 1.4.0.
- Notice: Copyright (c) 2025, Jeff Hlywa. Full text in licenses/chess.js.txt

