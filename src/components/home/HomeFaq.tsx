import { Minus, Plus } from "lucide-react";
import Link from "next/link";

const inlineLinkClassName =
  "text-ink hover:text-signal whitespace-nowrap underline decoration-1 underline-offset-[0.3em] hover:decoration-2 focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-solid";

const FAQ_ITEMS = [
  {
    question: "What is Junkyard Index?",
    answer: (
      <p>
        Junkyard Index brings vehicle listings from multiple salvage yards into
        one search. Look up a year, make, model, or VIN to find potential donor
        vehicles, then check the yard listing for details before you visit.
      </p>
    ),
  },
  {
    question: "Can I search for a specific part?",
    answer: (
      <p>
        We index vehicles, not individual parts. Search for a vehicle that may
        have the part you need, then confirm compatibility and availability with
        the yard. A listed vehicle does not guarantee that a particular part is
        still on it.
      </p>
    ),
  },
  {
    question: "Which junkyards are included?",
    answer: (
      <p>
        We index inventory from sources including LKQ, Row52, and Pull-A-Part.
        Browse the{" "}
        <Link href="#yards" className={inlineLinkClassName}>
          map and yard directory
        </Link>{" "}
        above, or see{" "}
        <Link href="/junkyards" className={inlineLinkClassName}>
          every yard by state
        </Link>{" "}
        with its full inventory. If a yard is missing, you can{" "}
        <Link href="/request-yard" className={inlineLinkClassName}>
          request it
        </Link>
        .
      </p>
    ),
  },
  {
    question: "How often is the inventory updated?",
    answer: (
      <p>
        We refresh inventory daily. How soon a vehicle appears depends on when
        its yard publishes the listing. Vehicles and parts can be removed
        between updates, so confirm availability with the yard before making a
        trip.
      </p>
    ),
  },
  {
    question: "Is Junkyard Index free to use?",
    answer: (
      <p>
        Yes. You can search for free, and a free account gives you full results
        with unlimited searches. Lite adds advanced filters and saved searches.
        Full adds email and Discord alerts. See the{" "}
        <Link href="/pricing" className={inlineLinkClassName}>
          plan comparison
        </Link>{" "}
        for details.
      </p>
    ),
  },
  {
    question: "Can I get an alert when a vehicle arrives?",
    answer: (
      <p>
        Yes. With the Full plan, save a search and enable email or Discord
        alerts. We notify you when newly indexed vehicles match it. You can
        choose which saved searches send alerts and how you receive them.
      </p>
    ),
  },
];

export function HomeFaq() {
  return (
    <section
      aria-labelledby="home-faq-title"
      className="shell grid gap-10 py-24 sm:py-36 lg:grid-cols-12 lg:gap-8"
    >
      <h2
        id="home-faq-title"
        className="text-section leading-[1.02] font-extrabold lg:sticky lg:top-28 lg:col-span-4 lg:self-start"
      >
        Frequently asked questions
      </h2>
      <div className="border-ink border-t-2 lg:col-span-8">
        {FAQ_ITEMS.map(({ question, answer }) => (
          <details key={question} className="group border-rule border-b">
            <summary className="board-step hover:text-signal focus-visible:outline-focus flex w-full list-none items-center justify-between gap-6 py-6 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid sm:py-7 [&::-webkit-details-marker]:hidden">
              <h3 className="text-title leading-tight font-extrabold tracking-[-0.02em]">
                {question}
              </h3>
              <span
                className="border-ink group-open:bg-ink group-open:text-paper grid size-9 shrink-0 place-items-center border-2"
                aria-hidden="true"
              >
                <Plus className="size-4 group-open:hidden" />
                <Minus className="hidden size-4 group-open:block" />
              </span>
            </summary>
            <div className="text-ink-2 max-w-[65ch] pr-12 pb-8 text-base leading-relaxed text-pretty">
              {answer}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
