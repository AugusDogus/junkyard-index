import { createRoot } from "react-dom/client";
import { VehicleRowPhoto } from "~/components/inventory/VehicleRowPhoto";
import { NoPhotoStrip, VehicleImage } from "~/components/search/VehicleImage";

// The proxy serves "ok"; photos.test serves "error" and "slow" from the
// origin only; "gone" loads nowhere.
const photos = ["ok", "error", "slow", "gone"];

function Fixture() {
  return (
    <main className="grid gap-4 p-4">
      {photos.map((name) => (
        <section key={name} data-photo={name} className="flex gap-4">
          <VehicleRowPhoto src={`https://photos.test/${name}.jpg`} />
          <div className="w-64">
            <VehicleImage
              src={`https://photos.test/${name}.jpg`}
              alt={`${name} card`}
              sizes="256px"
              frame={(photo) => (
                <div className="relative aspect-[2/1] overflow-hidden">
                  {photo}
                </div>
              )}
              missing={<NoPhotoStrip />}
            />
          </div>
        </section>
      ))}
    </main>
  );
}

createRoot(document.body).render(<Fixture />);
