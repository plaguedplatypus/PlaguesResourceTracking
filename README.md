# Plague's Resource Tracker

An Alt1 Toolkit app for RuneScape 3 that tracks Invention, Archaeology, Fishing and more.

The app started as a simple Mining tracker and has grown into a compact gathering companion for multiple skills. Designed to automatically track gathered resources, special rewards, and progress toward long-term goals without needing spreadsheets, notepads, calculators, or manual counting. Utilizes chat box timestamps for duplicate protection and accurate tracking.

## Features

### Resource Tracking
Tracked resources are categorized into skill tabs when the chat message or item type can be identified:

- All
- Mining
- Woodcutting
- Fishing
- Archaeology
- Invention
- Seren Spirits

### Invention Tracking
Tracks Invention material messages from disassembly and Divine Blessings, including:

- Common parts
- Uncommon components
- Rare components
- Ancient components

### Goal Tracking

- Set goals for any tracked item
- Progress bars
- Percentage completion
- Goal reached indicator
- Persistent save data

### Quality of Life

- Sort items by Recent, A-Z, or Count
- Per-item goal management
- Per-item reset and delete
- Clear tracking by selected skill tab
- Import / Export save data
- Scrollable item list
- Timestamped status updates
- Compact Alt1-friendly UI
- Debug/history window for checking tracked and ignored chat lines (Found an item not tracked that you think should be? Let me know)

### Fishing Mode
Fishing can produce duplicate chat messages when using Porters or Grace of the Elves.

The Settings panel includes a Fishing Porters toggle to switch between porter-based tracking and direct fishing-message tracking to help prevent duplicate counts.

## Requirements
- RuneScape chatbox visible on screen
- Chat timestamps must be enabled
- Sign of the Porter / Grace of the Elves is recommended for Mining and accurate Woodcutting tracking

## Installation

Source: https://github.com/plaguedplatypus/PlaguesResourceTracking

1. Open the app URL in Alt1:

   alt1://addapp/https://plaguedplatypus.github.io/PlaguesResourceTracking/appconfig.json

2. Allow:
   - View Screen
   - Get Game State
   - Show Overlay

3. Select the desired chatbox if prompted.
4. Start gathering.

## Limitations

- The app can only track resources that produce readable chatbox messages.
- Some resources go directly to inventory without a chat message and cannot be tracked automatically.
- Mining is only trackable when using Porters or Grace of the Elves.
- Some Woodcutting resources may be approximate when gathered directly to inventory without porter messages.
- Farming, herbs, Herblore, and general loot tracking are not currently supported though may still appear in the "ALL" tab.
- If something is missed, enable the debug/history option to view tracked and ignored chat lines. Copy the chat log if something needs to be fixed.