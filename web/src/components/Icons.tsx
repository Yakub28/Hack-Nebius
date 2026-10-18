// Small line icons on a 16px grid, drawn in currentColor so they take the text colour around them.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const StarIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.9l1.85 3.86 4.2.53-3.08 2.9.78 4.17L8 11.3l-3.75 2.06.78-4.17-3.08-2.9 4.2-.53z" {...S} fill={filled ? "currentColor" : "none"} /></svg>
);
export const XIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" {...S} /></svg>;
export const PlusIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" {...S} /></svg>;
export const CheckIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.4" {...S} strokeWidth={1.8} /></svg>;
export const ExternalIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3.2c0 .4-.4.8-.8.8H3.3c-.4 0-.8-.4-.8-.8V4.8c0-.4.4-.8.8-.8h3.2" {...S} /></svg>;
export const DownloadIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.8 7.4L8 10.6l3.2-3.2M2.5 10.5v2.2c0 .5.4.8.8.8h9.4c.4 0 .8-.3.8-.8v-2.2" {...S} /></svg>;
export const FilterIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M4.5 8h7M6.5 12h3" {...S} /></svg>;
export const SearchIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.25" {...S} /><path d="M10.2 10.2l3.3 3.3" {...S} /></svg>;
export const ChevronIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5" {...S} /></svg>;
export const RefreshIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 3.5v3h-3M3 12.5v-3h3M12.4 6.5A4.8 4.8 0 0 0 4 5M3.6 9.5A4.8 4.8 0 0 0 12 11" {...S} /></svg>;
export const AlertIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l6 10.8H2zM8 6.6v3M8 11.3v.2" {...S} /></svg>;
export const InfoIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.75" {...S} /><path d="M8 7.3v3.6M8 5.1v.2" {...S} /></svg>;
