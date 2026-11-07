# Backups, export and import

There are three things, and they are not substitutes for the operator's own backups of the server ([`deploy/README.md`](../deploy/README.md)).

## Export

Settings > Data > Export gives you a file (`tusk`, version 1) with your **Desk**, a **board**, a **workspace** (its boards and its people), or **everything**:
your Desk and every workspace you own. A board in someone else's workspace is theirs to export. If your Desk has a key of its own, the export is made in
your browser, as plain JSON, with a warning that it is no longer encrypted.

## Backup to a git repository

In Settings > Data, connect a **private** GitHub repository of yours, and Tusk commits your data to it as a **new file each time**, `tusk/2026-11-06_14-30-00.json`
(UTC), on the default branch. It is the same file as the "everything" export. Choose **by hand** (only on _Back up now_) or **automatically** (every hour, 6 hours,
day, or week). You see the repository, the last backup with a link to the file, the next, and what went wrong if something did.

You connect in one of two ways. **With a token:** make a fine-grained token on GitHub for that one repository, with _Contents: Read and write_, and paste it; Tusk
stores it sealed under the server's key and never shows it again. **With the GitHub App**, where whoever runs the server has set it up: install the App on that one
repository, and Tusk keeps no token at all.

What to know:

- **Only a private repository is accepted**, and it is checked again every time, because the file is plain text on GitHub's servers. (If your Desk has a key of
  its own, the Desk's part holds ciphertext, and boards are plain.)
- **Nothing is ever deleted, rewritten or forced.** Files accumulate; Tusk does not prune. Other files in the repository are never touched.
- **An automatic backup writes only if something changed.** _Back up now_ always writes, at most once a minute.
- **Failures are shown.** A network failure tries again at the next time. A token that stopped working, a repository that is gone or was made public **stops the
  automatic backups**, says so in Settings, and puts a notice in your Inbox.
- **Disconnecting, or deleting your account, removes the connection and the token and leaves the repository alone.** Delete the files there yourself if you
  want them gone.

## Restoring

Download the file you want from the repository and **import** it: Settings > Data > Import. Import **always creates and never replaces or merges**: Desk lists
are added to your Desk, a board is made in a workspace you choose, a workspace is made with you as its owner. Every id is new, so importing twice makes two
copies; it says what it found ("1 workspace, 4 boards, 312 cards") and asks before it writes. People are matched by email to accounts here; those who are in
the destination workspace stay assigned, the rest are dropped, and it says how many. Comments and activity are kept in the file as a record but are not
imported. A file that fails its checks changes nothing, and a file of a Desk that has a key needs your key. It also reads the file of the old Sovereign tasks
plugin, into your Desk.
