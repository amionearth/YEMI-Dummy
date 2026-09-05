# OpenPets Drag Vocab

An [OpenPets](https://github.com/open-pets/openpets) plugin that provides instant dictionary definitions and translations when you drag and drop text onto your pet!

## Features

- **Instant Translation & Definition:** Select any text on your screen, drag it, and drop it on your pet to get a quick definition and translation.
- **Anki Integration:** Optionally connect to your local Anki application (via AnkiConnect) to easily save translated words directly to an Anki deck for flashcard review.
- **Debounced Drops:** Smart coalescing ensures that even if your OS fires multiple drop events, you only get one clean result bubble.
- **Configurable Language:** Set your preferred target translation language directly from the OpenPets plugin settings UI.

## Installation

1. Open the OpenPets Desktop App.
2. Go to the Community Plugins list and install **Vocabulary Drag & Drop**.
3. Enable the plugin in the settings.
4. (Optional) Configure your preferred target language in the plugin's configuration page.
5. (Optional) Select `anki` as your integration provider and provide a deck name to save cards to Anki.

## Usage

Simply highlight a word or phrase in any application (like your browser, text editor, or PDF viewer) and drag it over your desktop pet. The pet will think for a moment and then pop up a text bubble with the translation and definition of the first word. If you've connected Anki, you'll see an "Add to Anki" button to instantly save the flashcard.

## Required Permissions

This plugin requires the following permissions to function:
- `pet:speak` - To notify you of any errors.
- `pet:drop` - To read the text you drag and drop onto the pet.
- `network` - To fetch definitions (DictionaryAPI) and translations (Google Translate).
- `network:local` - To communicate with your local Anki instance.
- `network:write` - To create flashcards in Anki.
- `events` - To listen to the drop events.
- `pet:reaction` - To show "thinking" and "success" visual reactions.
- `pet:interact` - To allow dismissing the bubble via the "Close" button.

## License

MIT
