# Working offline

Tusk keeps your Desk on the device you are using, so it works with no connection: the same screens, the same actions, nothing to wait for. When the
connection is back, what you did is sent to your other devices on its own. This page says exactly what that means, and where it stops.
([`DESIGN.md`](../DESIGN.md) §8 is the design.)

## What works with no connection

Everything on your **Desk**, once Tusk has been opened on that device with a connection at least once:

- opening Tusk, reading your lists and cards;
- adding a card, editing its title and description, starring it, giving it a due date, setting it to repeat;
- ticking cards and checklist items, marking a card in progress, reordering cards and lists with the mouse or the keyboard;
- moving cards between lists, choosing several cards at once, deleting and undoing;
- searching your Desk.

None of these shows an error for being offline, and none of them waits. Open Tusk with the network off and your Desk is there. **Install Tusk** (the
install button in Chrome or Edge, or Share, then Add to Home Screen on an iPhone or iPad) and it opens like any app.

## What needs a connection

Tusk says so when you try:

- **signing in**, and the first time you open Tusk on a new device, which fetches your Desk;
- **boards, workspaces, the Inbox and Settings**, which live on the server so that other people see the same thing. A board you had open stays on the screen
  as it was, read-only, with a line saying why; the Desk beside it is unaffected;
- **signing out**, which asks the server to end your session, so that no one else can use it.

## Getting your changes to your other devices

Changes made offline are kept in order on the device and sent as soon as the connection is back, from any open Tusk window; a changed card on one device
and a different change to the same card on another both stand, and two devices that change the same field settle on the later one. Nothing is asked of you.

Where your browser supports Background Sync (Chrome, Edge), a change made offline also asks the browser to wake Tusk when the connection returns. **It wakes
a Tusk window that is open; it cannot send anything with every window closed.** In that case the changes wait on the device, safely, until Tusk is next opened.

## Where it stops

- **On an iPhone or iPad, changes are sent only while Tusk is open.** Safari has no Background Sync. Open the app and they go.
- **A browser can clear a site's stored data** when the device is very short of space, in spite of Tusk asking it not to. Changes that have not been sent
  would then be lost. Tusk asks for lasting storage; installing it makes that more likely to be granted.
- **A shared computer** keeps a signed-in person's Desk until they sign out. Sign out when you are done: it removes your Desk and the record of who you are
  from that device.
