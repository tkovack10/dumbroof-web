/**
 * Server component that renders a single JSON-LD <script> tag. Pass any
 * schema.org object (or array) built with src/lib/seo/schema.ts.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
