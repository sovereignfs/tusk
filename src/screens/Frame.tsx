'use client';

import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThreeColumnLayout, useIsMobile } from '../ui';
import { Sidebar } from './Sidebar';
import { TaskDetail } from './TaskDetail';

/**
 * Below the shell's header (DESIGN.md §15.2): a sidebar of 280px, the content, and a right sidebar of 360px **that is there only while a task is
 * open**, so that it shows two columns at first. The dimensions are the design system's defaults, matched to the reference screenshot.
 *
 * The content has about 24px of padding, set by the page inside it and not here, since a page may want its header to reach the edge.
 *
 * On a phone this is not the layout (task 7.2 is the mobile shell). It is the same routes and the same data, with the columns it cannot fit left
 * out: **a navigation decision is never forked by viewport, only what is rendered** (DESIGN.md §15.1).
 */
export function Frame({ children }: { children: ReactNode }) {
  const task = useSearchParams().get('task');
  const mobile = useIsMobile();

  return (
    <ThreeColumnLayout sidebarHidden={mobile}>
      <Sidebar />
      <div style={{ padding: mobile ? 'var(--sv-space-4)' : 'var(--sv-space-6)' }}>{children}</div>
      {task && !mobile ? <TaskDetail taskId={task} /> : null}
    </ThreeColumnLayout>
  );
}
