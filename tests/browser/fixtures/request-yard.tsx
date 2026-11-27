import { createRoot } from "react-dom/client";
import { RequestYardForm } from "~/components/request-yard/RequestYardForm";

const root = document.querySelector("#root");
if (root) createRoot(root).render(<RequestYardForm />);
