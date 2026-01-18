export type DataSource = "pyp" | "row52";

// Location types based on the PYP _locationList structure
export interface Location {
  locationCode: string;
  locationPageURL: string;
  name: string;
  displayName: string;
  address: string;
  city: string;
  state: string;
  stateAbbr: string;
  zip: string;
  phone: string;
  lat: number;
  lng: number;
  distance: number;
  legacyCode: string;
  primo: string;
  source: DataSource;
  urls: {
    store: string;
    interchange: string;
    inventory: string;
    prices: string;
    directions: string;
    sellACar: string;
    contact: string;
    customerServiceChat: string | null;
    carbuyChat: string | null;
    deals: string;
    parts: string;
  };
}

// Vehicle information structure
export interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  color: string;
  vin: string;
  stockNumber: string;
  availableDate: string;
  location: Location;
  source: DataSource;
  yardLocation: {
    section: string;
    row: string;
    space: string;
  };
  images: VehicleImage[];
  detailsUrl: string;
  partsUrl: string;
  pricesUrl: string;
  engine?: string;
  trim?: string;
  transmission?: string;
}

export interface VehicleImage {
  url: string;
}

// Search filters interface
export interface SearchFilters {
  query: string;
  makes?: string[];
  models?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
  sources?: DataSource[];
  yearRange?: [number, number];
  dateRange?: [Date, Date];
  maxDistance?: number;
  userLocation?: [number, number];
  sortBy?: "newest" | "oldest" | "year-desc" | "year-asc" | "distance";
  sortOrder?: "asc" | "desc";
}

// Search result structure
export interface SearchResult {
  vehicles: Vehicle[];
  totalCount: number;
  page: number;
  hasMore: boolean;
  searchTime: number;
  locationsCovered: number;
  locationsWithErrors: string[];
}

// Parsed vehicle data from HTML
export interface ParsedVehicleData {
  id: string;
  year: number;
  make: string;
  model: string;
  color: string;
  vin: string;
  stockNumber: string;
  availableDate: string;
  yardLocation: {
    section: string;
    row: string;
    space: string;
  };
  images: VehicleImage[];
  detailsUrl: string;
  partsUrl: string;
  pricesUrl: string;
}

// Component props interfaces

export interface VehicleCardProps {
  vehicle: Vehicle;
}

export interface Row52ODataResponse<T> {
  "@odata.context": string;
  "@odata.count"?: number;
  value: T[];
}

export interface Row52Make {
  id: number;
  name: string;
}

export interface Row52Model {
  id: number;
  name: string;
  makeId: number;
  make?: Row52Make;
}

export interface Row52State {
  id: number;
  name: string;
  abbreviation: string;
  countryId: number;
}

export interface Row52Location {
  id: number;
  accountId: string;
  name: string;
  code: string;
  address1: string;
  address2: string | null;
  city: string;
  zipCode: string;
  stateId: number;
  phone: string;
  hours: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  isVisible: boolean;
  isParticipating: boolean;
  webUrl: string;
  logoUrl: string | null;
  partsPricingUrl: string;
  state?: Row52State;
}

export interface Row52Image {
  id: number;
  fileName: string;
  resourceUrl: string;
  vehicleId: number;
  size1: string;
  size2: string;
  size3: string;
  size4: string;
  original: string;
  extension: string;
  caption: string | null;
  sortOrder: number;
  isActive: boolean;
  isVisible: boolean;
}

export interface Row52Vehicle {
  id: number;
  vin: string;
  modelId: number;
  year: number;
  locationId: number;
  row: string;
  slot: string | null;
  barCodeNumber: string;
  dateAdded: string;
  creationDate: string;
  lastModificationDate: string;
  isActive: boolean;
  isVisible: boolean;
  defaultImage: number;
  color: string | null;
  engine: string | null;
  trim: string | null;
  transmission: string | null;
  model?: Row52Model;
  location?: Row52Location;
  images?: Row52Image[];
}
