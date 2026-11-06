import { formatDue } from '../format-due';
import { readableOn } from '../ui/contrast';
import type { PublishedBoard, PublishedCard } from '../workspaces/published';

/**
 * A published board as a page (DESIGN.md §14.6): HTML made on the server, **with no script in it and nothing that reaches out**, for anyone with the address.
 * Everything a person wrote is escaped as text. The colours of the board and its labels are data a person chose, so each becomes a class in the page's own
 * `<style>` (which carries the request's nonce), never an attribute, and only after it is checked to be `#rrggbb`. It shows the work and no people: the
 * board it is given has none to show.
 */
const escape = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const HEX = /^#[0-9a-f]{6}$/;
const className = (color: string): string => (HEX.test(color) ? `c${color.slice(1)}` : 'c-none');

const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
main { padding: 0 1.5rem 2rem; }
.band { height: 6px; }
h1 { margin: 1rem 0 0.25rem; font-size: 1.6rem; }
.muted { color: GrayText; font-size: 0.9rem; }
.columns { display: flex; align-items: flex-start; gap: 1rem; overflow-x: auto; padding: 1rem 0; }
.column { flex: none; width: 17rem; border: 1px solid GrayText; border-radius: 8px; padding: 0.5rem; }
.column h2 { margin: 0 0 0.5rem; font-size: 1rem; }
.card { display: block; margin: 0 0 0.5rem; padding: 0.5rem; border: 1px solid GrayText; border-radius: 6px; color: inherit; text-decoration: none; }
.card:hover, .card:focus-visible { outline: 2px solid Highlight; }
.bars { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.bar { display: inline-block; width: 2.5rem; height: 0.4rem; border-radius: 3px; }
.chip { display: inline-block; margin: 0 0.25rem 0.25rem 0; padding: 0 0.5rem; border-radius: 4px; font-size: 0.85rem; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
.done { text-decoration: line-through; color: GrayText; }
a { color: LinkText; }
`;

function colours(board: PublishedBoard): string {
  const seen = new Set<string>([board.color, ...board.labels.map((label) => label.color)]);
  return [...seen]
    .filter((color) => HEX.test(color))
    .map((color) => `.${className(color)}{background:${color};color:${readableOn(color)}}`)
    .join('');
}

function page(board: PublishedBoard, nonce: string, body: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escape(title)}</title>
<style nonce="${escape(nonce)}">${STYLE}${colours(board)}</style>
</head>
<body>
<div class="band ${className(board.color)}"></div>
<main>
${body}
</main>
</body>
</html>`;
}

const dueText = (card: PublishedCard, today: string): string =>
  card.dueDate ? formatDue(card.dueDate, card.dueTime, today, 'en').text : '';

function chips(board: PublishedBoard, card: PublishedCard): string {
  return card.labels
    .map((id) => board.labels.find((each) => each.id === id))
    .filter((label): label is PublishedBoard['labels'][number] => label !== undefined)
    .map(
      (label) =>
        `<span class="chip ${className(label.color)}">${escape(label.name === '' ? ' ' : label.name)}</span>`,
    )
    .join('');
}

/** The whole board: its lists side by side, each card a link to its read-only detail at `?card=`. */
export function renderBoard(board: PublishedBoard, nonce: string, today: string): string {
  const columns = board.lists
    .map((list) => {
      const cards = list.cards
        .map((card) => {
          const bars = card.labels
            .map((id) => board.labels.find((each) => each.id === id))
            .filter((label): label is PublishedBoard['labels'][number] => label !== undefined)
            .map((label) => `<span class="bar ${className(label.color)}"></span>`)
            .join('');
          const done = card.checklist.filter((item) => item.done).length;
          const meta = [
            dueText(card, today),
            card.checklist.length > 0 ? `${done}/${card.checklist.length}` : '',
          ]
            .filter((each) => each !== '')
            .join(' · ');
          return `<a class="card" href="?card=${escape(card.id)}">${bars ? `<div class="bars">${bars}</div>` : ''}<div>${escape(card.title)}</div>${meta ? `<div class="muted">${escape(meta)}</div>` : ''}</a>`;
        })
        .join('\n');
      return `<section class="column"><h2>${escape(list.name)}</h2>\n${cards}</section>`;
    })
    .join('\n');
  const body = `<h1>${escape(board.name)}</h1>
${board.description ? `<p class="muted text">${escape(board.description)}</p>` : ''}
${board.archived ? '<p class="muted">This board is archived.</p>' : ''}
<div class="columns">
${columns}
</div>`;
  return page(board, nonce, body, board.name);
}

/** One card, read-only, with a way back to the board. Undefined if the board has no such card. */
export function renderCard(
  board: PublishedBoard,
  cardId: string,
  nonce: string,
  today: string,
): string | undefined {
  const list = board.lists.find((each) => each.cards.some((card) => card.id === cardId));
  const card = list?.cards.find((each) => each.id === cardId);
  if (!list || !card) return undefined;
  const due = dueText(card, today);
  const items = card.checklist
    .map(
      (item) =>
        `<li class="${item.done ? 'done' : ''}">${item.done ? '&#10003; ' : ''}${escape(item.title)}</li>`,
    )
    .join('\n');
  const body = `<p><a href="?">&larr; ${escape(board.name)}</a></p>
<h1>${escape(card.title)}</h1>
<p class="muted">in ${escape(list.name)}${due ? ` &middot; due ${escape(due)}` : ''}</p>
${card.labels.length > 0 ? `<p>${chips(board, card)}</p>` : ''}
${card.description ? `<p class="text">${escape(card.description)}</p>` : ''}
${card.checklist.length > 0 ? `<h2>Checklist</h2>\n<ul>\n${items}\n</ul>` : ''}`;
  return page(board, nonce, body, `${card.title} · ${board.name}`);
}

/** What is shown for an address that is nothing: the same page for a token that never was, one taken away, and a board that was deleted. */
export function renderNotHere(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not here</title>
<style nonce="${escape(nonce)}">:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;padding:2rem}</style>
</head>
<body><h1>That is not here</h1><p>This address does not lead to a board.</p></body>
</html>`;
}
