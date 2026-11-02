// Small stroke icons for the HUD and the domain picker. All inherit currentColor.

function Icon({ children, className = "icon" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function FuelIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3c3.4 4 5.6 6.8 5.6 10.1A5.6 5.6 0 0 1 12 18.7a5.6 5.6 0 0 1-5.6-5.6C6.4 9.8 8.6 7 12 3Z" />
      <path d="M9.6 13.4a2.5 2.5 0 0 0 2.4 2.3" />
    </Icon>
  );
}

export function PowerIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3.6" y="7.2" width="14.8" height="9.6" rx="2" />
      <path d="M20.6 10.6v2.8M11.8 9l-2.2 3.2h3.2l-2.2 3.2" />
    </Icon>
  );
}

export function CreditIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.6v8.8M9.4 10.2c.4-.9 1.4-1.3 2.6-1.3 1.5 0 2.6.7 2.6 1.8 0 2.4-5.2 1-5.2 3.4 0 1.1 1.1 1.8 2.6 1.8 1.2 0 2.2-.4 2.6-1.3" />
    </Icon>
  );
}

export function ClockIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12.6" r="7.6" />
      <path d="M12 8.4v4.4l3 1.8M9.6 3.4h4.8" />
    </Icon>
  );
}

export function GlobeIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.8 12h16.4M12 3.6c2.4 2.4 3.6 5.2 3.6 8.4s-1.2 6-3.6 8.4c-2.4-2.4-3.6-5.2-3.6-8.4s1.2-6 3.6-8.4Z" />
    </Icon>
  );
}

export function BrainIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 4.6v14.8M12 6.4c-.4-1.6-1.6-2.4-3-2.4a3 3 0 0 0-2.8 3.6A3.2 3.2 0 0 0 5.4 13a3.2 3.2 0 0 0 1.5 3.6A3 3 0 0 0 9.2 20c1.4 0 2.4-.8 2.8-2M12 6.4c.4-1.6 1.6-2.4 3-2.4a3 3 0 0 1 2.8 3.6A3.2 3.2 0 0 1 18.6 13a3.2 3.2 0 0 1-1.5 3.6A3 3 0 0 1 14.8 20c-1.4 0-2.4-.8-2.8-2" />
    </Icon>
  );
}

export function ChipIcon(props) {
  return (
    <Icon {...props}>
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2" />
      <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.8" />
      <path d="M9.6 3.6v2.8M14.4 3.6v2.8M9.6 17.6v2.8M14.4 17.6v2.8M3.6 9.6h2.8M3.6 14.4h2.8M17.6 9.6h2.8M17.6 14.4h2.8" />
    </Icon>
  );
}
