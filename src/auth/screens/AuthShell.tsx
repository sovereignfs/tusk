import type { ReactNode } from 'react';
import { AuthCard, AuthFooter, BrandBadge } from '../../ui';
import { markOf } from '../../ui/brand';
import { site } from '../../site';

/**
 * The frame of a screen before sign-in: the design system's card, with the app's mark above the title. `footer` is the small print under the form,
 * such as a link back to sign in. There are no legal links: this app has no pages for them yet, and a link to a page that is not there is worse
 * than none.
 */
export function AuthShell({
  title,
  lead,
  children,
  footer,
  footerAlign,
}: {
  title: string;
  lead?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** `start` for a screen that is only a message and a link, so the link lines up under the text. */
  footerAlign?: 'start';
}) {
  return (
    <AuthCard
      brand={<BrandBadge name={site.name} mark={markOf(site.name)} />}
      title={title}
      {...(lead ? { lead } : {})}
      legal={false}
    >
      {children}
      {footer ? (
        <AuthFooter {...(footerAlign ? { align: footerAlign } : {})}>{footer}</AuthFooter>
      ) : null}
    </AuthCard>
  );
}
