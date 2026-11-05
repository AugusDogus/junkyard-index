import { StructuredData, type JsonLdNode } from "~/lib/structured-data";

export function JsonLd({ nodes }: { nodes: readonly JsonLdNode[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: StructuredData.serialize(StructuredData.graph(nodes)),
      }}
    />
  );
}
