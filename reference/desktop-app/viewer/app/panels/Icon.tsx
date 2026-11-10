// The toolbar's local SVG icons (ui-icons.js) as a React element.
import { UIIcons } from '../../shared/ui-icons.js';

const shape = UIIcons.shape as (name: string) => string;

export function Icon({ name }: { name: string }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      // Icon geometry is local constant data.
      dangerouslySetInnerHTML={{ __html: shape(name) }}
    />
  );
}
