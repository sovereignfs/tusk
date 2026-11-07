# Workspaces, and who sees what

A **workspace** holds boards you share with other people. It has **owners** (at least one) and **members**. A **board** in it has **owners** and **members**
too, drawn from the workspace's people. Someone who can see a board without being its member is a **viewer**: they see everything and can change nothing.
([`DESIGN.md`](../DESIGN.md) §7 is the design.)

| What                                                     | Workspace owner | Workspace member | Board owner | Board member |
| -------------------------------------------------------- | :-------------: | :--------------: | :---------: | :----------: |
| See the workspace, and its public boards                 |        ✓        |        ✓         |      —      |      —       |
| See a private board                                      |        ✓        |                  |      ✓      |      ✓       |
| Join a public board, as a member                         |        ✓        |        ✓         |      —      |      —       |
| Create a board (and become its owner)                    |        ✓        |        ✓         |      —      |      —       |
| Change a board's lists, cards, labels and comments       |                 |                  |      ✓      |      ✓       |
| A board's settings, members, publishing, archive, delete |        ✓        |                  |      ✓      |              |
| Rename or delete the workspace; its members and roles    |        ✓        |                  |      —      |      —       |
| Leave                                                    |  ✓ (not last)   |        ✓         |      ✓      |      ✓       |

- **Only a board's members can change what is on it.** A workspace owner who is not a member of a board can see it and run it, and cannot touch its cards;
  they can add themselves, and that is recorded in the board's activity.
- **A public board is public to the workspace, not to the world.** Anyone in the workspace sees it and can join it. A **private** board is seen only by its
  members and by the workspace's owners. (To show a board to people with no account, [publish](publishing.md) it.)
- **An archived board is read-only for everyone**, its owners included, until one restores it.
- **A comment** is edited or deleted by its author, and deleted by a board owner.
- **A workspace always has an owner.** The last owner cannot leave or step down: they make someone else an owner first, or delete the workspace.
- **Removing someone from a workspace** removes them from each of its boards and unassigns them from its cards. Their comments and activity stay, under their
  name.
- **Adding someone is by email address**, and only for an address that already has an account here. Tusk will say that an address has no account, since it
  cannot add them otherwise, and it is limited per person.

## What an operator can see

Boards are stored as plain text, so **whoever runs the server can read every board**, whatever its visibility: private to the board's members is private from
the other people on the server, not from its operator. Your [Desk can be sealed](encryption.md) from them, and boards cannot.

## If you delete your account

A workspace you alone own **passes to the member who has been in it longest**, who is told in their Inbox, or is **deleted with its boards if nobody else is in
it**. You are taken out of every workspace and board you were in. Your comments and the cards you made stay on boards that carry on, shown as by "Deleted
account". See [backups](backup.md) for what is left outside Tusk.
