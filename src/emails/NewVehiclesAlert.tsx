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
import type { SearchAlertMatch } from "~/lib/search-alert-data";

interface NewVehiclesAlertItem {
  searchName: string;
  query: string;
  match: SearchAlertMatch;
  searchUrl: string;
  unsubscribeUrl: string;
}

interface NewVehiclesAlertProps {
  digest: {
    previewAlerts: NewVehiclesAlertItem[];
    alertCount: number;
    vehicleCount: number;
  };
  manageSearchesUrl: string;
}

const MAX_DIGEST_VEHICLES = 10;

export function NewVehiclesAlert({
  digest,
  manageSearchesUrl,
}: NewVehiclesAlertProps) {
  const previewText = `${digest.vehicleCount} new vehicle${digest.vehicleCount === 1 ? "" : "s"} across ${digest.alertCount} saved search${digest.alertCount === 1 ? "" : "es"}`;
  const previewVehicleCount = digest.previewAlerts.reduce(
    (total, alert) => total + alert.match.count,
    0,
  );
  const omittedAlertCount = digest.alertCount - digest.previewAlerts.length;
  const omittedVehicleCount = digest.vehicleCount - previewVehicleCount;
  const vehiclesPerSearch =
    digest.previewAlerts.length > 0
      ? Math.max(
          1,
          Math.floor(MAX_DIGEST_VEHICLES / digest.previewAlerts.length),
        )
      : 0;
  const displayAlerts = digest.previewAlerts.map((alert) => {
    const vehiclesToShow = alert.match.previewVehicles.slice(
      0,
      vehiclesPerSearch,
    );
    return {
      alert,
      vehiclesToShow,
      remainingCount: alert.match.count - vehiclesToShow.length,
    };
  });

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className="bg-gray-100 font-sans">
          <Container className="mx-auto max-w-[600px] bg-white px-5 py-10">
            <Heading className="m-0 mb-5 border-b-2 border-gray-200 pb-2.5 text-2xl font-semibold text-gray-900">
              Daily Saved Search Update
            </Heading>

            <Text className="m-0 mb-5 text-base text-gray-700">
              We found <strong>{digest.vehicleCount}</strong> new vehicle
              {digest.vehicleCount === 1 ? "" : "s"} across{" "}
              <strong>{digest.alertCount}</strong> saved search
              {digest.alertCount === 1 ? "" : "es"}.
            </Text>

            {displayAlerts.map(({ alert, vehiclesToShow, remainingCount }) => {
              return (
                <Section key={alert.unsubscribeUrl} className="my-8">
                  <Section className="my-5 rounded bg-gray-100 p-4">
                    <Heading
                      as="h2"
                      className="m-0 text-lg font-semibold text-gray-900"
                    >
                      {alert.searchName}
                    </Heading>
                    <Text className="m-0 mt-1 text-sm text-gray-700">
                      {alert.match.count} new vehicle
                      {alert.match.count === 1 ? "" : "s"}
                      {alert.query ? ` for "${alert.query}"` : ""}
                    </Text>
                  </Section>

                  {vehiclesToShow.map((vehicle) => (
                    <Link
                      key={vehicle.id}
                      href={vehicle.detailsUrl}
                      className="mb-4 block rounded border border-gray-200 bg-gray-50 p-3 no-underline"
                    >
                      <Row>
                        <Column className="w-[100px] align-top">
                          {vehicle.imageUrl ? (
                            <Img
                              src={vehicle.imageUrl}
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
                            {vehicle.locationName}
                          </Text>
                          <Text className="m-0 text-xs text-gray-500">
                            {vehicle.locationCity}, {vehicle.stateAbbr}
                          </Text>
                          {vehicle.row && (
                            <Text className="m-0 text-xs text-gray-500">
                              Row {vehicle.row}
                              {vehicle.space && `, Space ${vehicle.space}`}
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

                  <Section className="my-6 text-center">
                    <Button
                      href={alert.searchUrl}
                      className="inline-block rounded bg-gray-900 px-6 py-3 text-base font-medium text-white no-underline"
                    >
                      View Results
                    </Button>
                  </Section>

                  <Text className="m-0 text-center text-xs text-gray-500">
                    <Link
                      href={alert.unsubscribeUrl}
                      className="text-gray-900 underline"
                    >
                      Unsubscribe from this alert
                    </Link>
                  </Text>
                </Section>
              );
            })}

            {omittedAlertCount > 0 && (
              <Text className="m-0 my-6 text-center text-sm text-gray-600">
                ...and {omittedAlertCount} more saved search
                {omittedAlertCount === 1 ? "" : "es"} with {omittedVehicleCount}{" "}
                new vehicle
                {omittedVehicleCount === 1 ? "" : "s"}.{" "}
                <Link
                  href={manageSearchesUrl}
                  className="text-gray-900 underline"
                >
                  View all saved searches
                </Link>
                .
              </Text>
            )}

            <Hr className="my-8 border-gray-200" />

            <Text className="m-0 text-xs text-gray-500">
              You&apos;re receiving this email because you have email alerts
              enabled for one or more saved searches.{" "}
              <Link
                href={manageSearchesUrl}
                className="text-gray-900 underline"
              >
                Manage your saved searches
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
