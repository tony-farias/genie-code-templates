import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ShieldIcon = (props: IconProps) => (
  <Icon {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></Icon>
);
export const DashboardIcon = (props: IconProps) => (
  <Icon {...props}><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></Icon>
);
export const SearchIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></Icon>
);
export const SparklesIcon = (props: IconProps) => (
  <Icon {...props}><path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9L12 3Z"/><path d="m5 3-.6 1.4L3 5l1.4.6L5 7l.6-1.4L7 5l-1.4-.6L5 3Z"/><path d="m19 17-.8 2.2L16 20l2.2.8L19 23l.8-2.2L22 20l-2.2-.8L19 17Z"/></Icon>
);
export const UsersIcon = (props: IconProps) => (
  <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></Icon>
);
export const FileIcon = (props: IconProps) => (
  <Icon {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></Icon>
);
export const MoneyIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 6v12"/></Icon>
);
export const AlertIcon = (props: IconProps) => (
  <Icon {...props}><path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></Icon>
);
export const ChartIcon = (props: IconProps) => (
  <Icon {...props}><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 4-7"/></Icon>
);
export const InfoIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></Icon>
);
export const ArrowIcon = (props: IconProps) => (
  <Icon {...props}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>
);
export const CloseIcon = (props: IconProps) => (
  <Icon {...props}><path d="m18 6-12 12M6 6l12 12"/></Icon>
);
export const SendIcon = (props: IconProps) => (
  <Icon {...props}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></Icon>
);
export const LightbulbIcon = (props: IconProps) => (
  <Icon {...props}><path d="M9 18h6M10 22h4"/><path d="M15 14c.2-1 .7-1.7 1.5-2.5A6 6 0 1 0 7.5 11.5C8.3 12.3 8.8 13 9 14"/></Icon>
);
