import { Minus, Plus } from "lucide-react";
import Link from "next/link";

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
        <Link href="#yards" className="underline underline-offset-4">
          map and yard directory
        </Link>{" "}
        above to see current coverage. If a yard is missing, you can{" "}
        <Link href="/request-yard" className="underline underline-offset-4">
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
        <Link href="/pricing" className="underline underline-offset-4">
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
      className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
    >
      <div className="mx-auto max-w-3xl">
        <h2
          id="home-faq-title"
          className="mb-8 text-center text-3xl font-semibold tracking-tight text-balance sm:mb-12 sm:text-4xl"
        >
          Frequently asked questions
        </h2>
        <div className="border-t">
          {FAQ_ITEMS.map(({ question, answer }) => (
            <details key={question} className="group border-b">
              <summary className="focus-visible:ring-ring/50 flex w-full list-none items-center justify-between gap-6 rounded-sm py-5 text-left text-base font-medium outline-none focus-visible:ring-2 sm:py-6 [&::-webkit-details-marker]:hidden">
                <h3>{question}</h3>
                <Plus
                  className="text-muted-foreground size-4 shrink-0 group-open:hidden"
                  aria-hidden="true"
                />
                <Minus
                  className="text-muted-foreground hidden size-4 shrink-0 group-open:block"
                  aria-hidden="true"
                />
              </summary>
              <div className="text-muted-foreground pr-8 pb-6 text-sm leading-relaxed text-pretty">
                {answer}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
