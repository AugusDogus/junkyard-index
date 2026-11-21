import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchableCheckboxList } from "./SearchableCheckboxList";

const noOp = () => undefined;
const checkboxes = (markup: string) =>
  markup.match(/role="checkbox"/g)?.length ?? 0;
const options = (count: number) =>
  Array.from({ length: count }, (_, index) => `Option ${index}`);

test("renders every option of a short list", () => {
  const markup = renderToStaticMarkup(
    <SearchableCheckboxList
      name="state"
      label="State"
      options={options(45)}
      selected={[]}
      onChange={noOp}
      maxHeight={280}
    />,
  );
  expect(checkboxes(markup)).toBe(45);
});

test("renders only the rows in view of a long list, selected values first", () => {
  const markup = renderToStaticMarkup(
    <SearchableCheckboxList
      name="color"
      label="Color"
      options={options(1881)}
      selected={["Option 1500"]}
      onChange={noOp}
      maxHeight={260}
    />,
  );
  const rendered = checkboxes(markup);
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(40);
  expect(markup).toContain("Option 1500");
  expect(markup).not.toContain("Option 1880");
  // The scroll area keeps the full list's height so the scrollbar is honest.
  expect(markup).toContain(`height:${1881 * 40}px`);
});
