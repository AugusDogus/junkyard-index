import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import type { Vehicle } from "~/lib/types";

interface NewVehiclesAlertProps {
  searchName: string;
  query: string;
  newVehicles: Vehicle[];
  searchUrl: string;
  unsubscribeUrl: string;
}

export function NewVehiclesAlert({
  searchName,
  query,
  newVehicles,
  searchUrl,
  unsubscribeUrl,
}: NewVehiclesAlertProps) {
  const previewText = `${newVehicles.length} new vehicle${newVehicles.length === 1 ? "" : "s"} found for "${searchName}"`;

  // Limit to first 10 vehicles with images for email size
  const vehiclesToShow = newVehicles.slice(0, 10);
  const remainingCount = newVehicles.length - vehiclesToShow.length;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="mx-auto max-w-[600px] bg-white px-5 py-10">
            <Heading className="m-0 mb-5 border-b-2 border-gray-200 pb-2.5 text-2xl font-semibold text-gray-900">
              New Vehicles Found
            </Heading>

            <Text className="m-0 mb-5 text-base text-gray-700">
              We found <strong>{newVehicles.length}</strong> new vehicle
              {newVehicles.length === 1 ? "" : "s"} matching your saved search:
            </Text>

            <Section className="my-5 rounded bg-gray-100 p-4">
              <Text className="m-0 my-1 text-sm text-gray-700">
                <strong>Search:</strong> {searchName}
              </Text>
              <Text className="m-0 my-1 text-sm text-gray-700">
                <strong>Query:</strong> {query || "All vehicles"}
              </Text>
            </Section>

            <Heading
              as="h2"
              className="mt-8 mb-4 text-lg font-semibold text-gray-900"
            >
              New Vehicles:
            </Heading>

            {vehiclesToShow.map((vehicle) => (
              <Link
                key={vehicle.id}
                href={vehicle.detailsUrl}
                className="mb-4 block rounded border border-gray-200 bg-gray-50 p-3 no-underline"
              >
                <Row>
                  <Column className="w-[100px] align-top">
                    {vehicle.images[0]?.url ? (
                      <Img
                        src={vehicle.images[0].url}
                        alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                        width={90}
                        height={68}
                        className="rounded"
                      />
                    ) : (
                      <Section className="flex h-[68px] w-[90px] items-center justify-center rounded bg-gray-200">
                        <Text className="m-0 text-xs text-gray-500">
                          No image
                        </Text>
                      </Section>
                    )}
                  </Column>
                  <Column className="pl-3 align-top">
                    <Text className="m-0 text-sm font-semibold text-gray-900">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </Text>
                    {vehicle.color && (
                      <Text className="m-0 text-xs text-gray-600">
                        {vehicle.color}
                      </Text>
                    )}
                    <Text className="m-0 mt-1 text-xs text-gray-500">
                      {vehicle.location.name}, {vehicle.location.stateAbbr}
                    </Text>
                    {vehicle.yardLocation.row && (
                      <Text className="m-0 text-xs text-gray-500">
                        Row {vehicle.yardLocation.row}
                        {vehicle.yardLocation.space &&
                          `, Space ${vehicle.yardLocation.space}`}
                      </Text>
                    )}
                  </Column>
                </Row>
              </Link>
            ))}

            {remainingCount > 0 && (
              <Text className="m-0 mt-2 text-center text-sm text-gray-500 italic">
                ...and {remainingCount} more vehicle
                {remainingCount === 1 ? "" : "s"}
              </Text>
            )}

            <Section className="my-8 text-center">
              <Button
                href={searchUrl}
                className="inline-block rounded bg-gray-900 px-6 py-3 text-base font-medium text-white no-underline"
              >
                View All Results
              </Button>
            </Section>

            <Hr className="my-8 border-gray-200" />

            <Text className="m-0 text-xs text-gray-500">
              You&apos;re receiving this email because you have email alerts
              enabled for this search.{" "}
              <Link href={unsubscribeUrl} className="text-gray-900 underline">
                Unsubscribe from this alert
              </Link>{" "}
              or{" "}
              <Link href={searchUrl} className="text-gray-900 underline">
                manage your saved searches
              </Link>
              .
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default NewVehiclesAlert;
