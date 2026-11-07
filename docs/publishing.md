# Publishing a board

A board's owners can publish it from its **Share** dialog. It gets an address, `/p/<token>`, that **anyone can open without an account**. ([`DESIGN.md`](../DESIGN.md)
§14.6 is the design.)

## What the page shows

The work, read-only: the board's name and colour, its lists, and its cards with their titles, descriptions, labels, due dates and checklists. A card opens to a
read-only detail.

## What it never shows

**No people.** No members, no assignees, no email addresses, no comments and no activity: the page is made by a query that does not select them, and a test
holds it to that. Nothing on it can be changed.

## The address

- The token is 32 random bytes, so the address cannot be guessed, and it is not listed anywhere public. **Anyone who has the address can open it**, and can
  pass it on: treat it as you would a link to a document that is open to everyone who has it.
- **Unpublishing deletes the token for good.** That address stops working, and publishing again makes a new one. A deleted board's address is a 404.
- The page is always the board **as it is now**, archived or not.
- It is plain HTML with no script, a strict content policy, `noindex` so that search engines are asked to leave it alone, and a limit on how often one
  address can ask for it.
- **Your published boards are listed** in the Share dialog of each and in Settings > Data, so you can see what of yours is public.

## What it does not do

A published page is plain text served by the server, so [encryption](encryption.md) does not apply to it, and whoever runs the server can read it, as they can
read the board. It is not access control: if the work must not be seen by people outside, do not publish it.
