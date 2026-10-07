// Marks a shipped app the person has edited. The catalog no longer re-syncs such
// an app (see shouldReseedCuratedRow), so the tag says why it can differ from
// what a catalog update would bring.
//
// Colors: tan-dark text on the sand surface is 5.5:1 in light mode and 9.0:1 in
// dark mode (WCAG AA asks for 4.5:1 at this size).
export default function ModifiedTag() {
  return (
    <span
      className="shrink-0 inline-flex items-center rounded-full border border-desert-tan-light bg-desert-sand px-2 py-0.5 text-xs font-medium text-desert-tan-dark"
      title="You have edited this app, so catalog updates leave it as you set it."
    >
      modified
    </span>
  )
}
