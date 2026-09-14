---
name: Vertical Japanese text (縦書き) with CSS
description: How シフト先生's 備考 (day remarks) renders multi-entry vertical text without rotating latin/numeral characters, and why editing stays horizontal.
---

For 備考 (day remarks) in シフト先生, display text vertically (縦書き) using:

```css
writing-mode: vertical-rl;
text-orientation: upright;
```

`text-orientation: upright` is the key choice — without it, Latin letters and half-width
numerals (e.g. "D", "2") get rotated 90° sideways inside vertical-rl text, which looks wrong
for mixed Japanese/alphanumeric strings like "D残り". `upright` forces every character
(kanji, kana, Latin, numerals) to render right-side-up and simply stack top-to-bottom.

**Why:** The 備考 spec required entries like "D残り" or "西町ヘルプ" to display as natural
vertical columns without rotated letters, and without truncating ("...") content.

**How to apply:** Only the *display* cell uses vertical-rl/upright CSS. The *edit* UI (a
bottom drawer with a `<textarea>`) stays plain horizontal text — the user types normally,
and each newline in the saved string becomes one vertical column (capped at 2 columns
shown). Row height for the whole row is computed dynamically from the longest entry
(chars × per-char height), clamped to a max, rather than fixed — avoids both truncation
and unbounded row growth.
