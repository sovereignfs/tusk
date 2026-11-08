# Encryption: what it covers, and what it does not

By default nothing is encrypted by Tusk: your Desk and your boards are stored as plain text in the server's database, which is as private as the server
and whoever runs it. **You can seal your Desk with a key of your own**, so that the server holds only ciphertext. ([`DESIGN.md`](../DESIGN.md) §9 is the
design.)

## The key of your own

In Settings > Data, or when you first sign in (you can skip, and turn it on later), Tusk makes an [age](https://age-encryption.org) key in your browser, and makes
you save it before it goes on: download the file, and say you did. You can also use a key you already have, by file or by pasting it. **Nobody can recover
it, you included.** Lose the key and every device that has it, and your Desk is gone. On a new device you give the key once, and it stays on that device
until you sign out.

It is **one way**: to go back to plain text, export your Desk and start again with a new account.

## What it covers

**Your Desk, and only your Desk.** The titles, descriptions, checklist items, list names and colours, repeat rules, dates, stars and times of your lists and
cards are encrypted in your browser before they leave it. Search, counts and repeating cards work as before, because they happen in your browser.

The server can still see **that things exist and when they change**: ids, which list a card is in, positions, when something was deleted, how many
cards you have, and the size and timing of each change. Whoever runs it can see how much you use it, and not what you wrote.

## What it does not cover

- **Boards.** They are shared, read by everyone on them, and rendered by the server (for the Inbox, activity and published pages), so the server reads what is
  on them. Tusk says so wherever it offers the key: _your Desk can be yours alone; boards are shared, and the server can read them_.
- **What was written before.** Turning the key on later re-encrypts your Desk, but **older database backups, and files already committed to a backup
  repository, stay readable**. Settings says so at the time.
- **A server that cheats.** A key in your browser protects what is stored. It cannot protect you from a server that sends your browser altered code to take
  the key: your browser runs whatever the server sends. This is true of every web app that encrypts in the browser, and the answer to it is to trust whoever
  runs the server, or to run it yourself.
- **A shared computer.** Your Desk, and your key if you gave it, stay on a device until you sign out of it.

## What changes when your Desk has a key

- **Export** is made in your browser, as plain JSON in your hands, with a warning.
- **Backups to git** hold the Desk's part as ciphertext and the wrapped keys, so the backup is as private as the database. Importing one needs your key.
  Tusk asks you to confirm, once, that backups should go on after the key is set, because the files written before stay plain.
- **Reminders** work from times only, since the server cannot read what a card says. Your device tells the server _when_ a card is due (an instant, with no card and
  no count), and the server wakes your device at that time; email and the bell say only "You have cards due". The daily brief is not made for a Desk with a key,
  since it would have to count cards. If you choose it on a device, a reminder there can name the card: that device then gives Tusk's service worker the Desk's list
  keys (not your own key), kept until you turn it off, lock the Desk, forget the key or sign out. Without it the reminder still comes, and says only that cards are due.
  A device you have not opened Tusk on for 14 days stops getting reminders. The Planner reads your Desk on this device, so a Desk with a key of your own is in it once unlocked; the boards' cards come from the server as they do on a board.

## The server's own key

`TUSK_ENCRYPTION_KEY` is not yours: it seals the credentials people give Tusk (a repository's token), on the server. Encrypting **everything** with a key the
operator holds (`TUSK_DB_ENCRYPTION=on`) is a different thing: it protects against a stolen database or disk and **not against the operator**, who holds the key and can read everything. Personal keys
are not offered while it is on. See [`deploy/README.md`](../deploy/README.md) for how it is turned on, moved to and rotated.
