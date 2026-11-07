'use client';

/**
 * The design system, for pages to import (DESIGN.md §15.1). `@sovereignfs/ui` is one bundle with no `'use client'` directive and it calls
 * `createContext` at module scope, so a Server Component that imports it directly fails to build ("createContext is not a function").
 * Re-exporting from a client module makes each component a client reference: it still renders on the server, into the static HTML, and no page
 * needs to be a client component.
 *
 * Export only what is used; a Server Component cannot pass functions to these, only data and children. Icon names and props are taken from the
 * package's types (`IconName`; an `Icon` needs `aria-hidden` or `aria-label`), not its README.
 */
export {
  Alert,
  AuthButton,
  AuthCard,
  AuthDivider,
  AuthError,
  AuthField,
  AuthFooter,
  AuthForm,
  AuthLink,
  AuthNotice,
  Avatar,
  BrandBadge,
  Button,
  ButtonLink,
  Checkbox,
  ColorPicker,
  DatePicker,
  ConfirmDialog,
  Dialog,
  Drawer,
  EmptyState,
  FormField,
  Icon,
  Input,
  Menu,
  Popover,
  SegmentedControl,
  Select,
  Spinner,
  Textarea,
  ThreeColumnLayout,
  ToastProvider,
  useIsMobile,
  useToast,
  UserMenu,
} from '@sovereignfs/ui';
export type { IconName } from '@sovereignfs/ui';
