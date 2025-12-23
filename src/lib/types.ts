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

export interface VehicleImage {
  url: string;
  thumbnailUrl: string;
  type:
    | "CAR-FRONT-LEFT"
    | "CAR-BACK-LEFT"
    | "CAR-BACK-RIGHT"
    | "CAR-FRONT-RIGHT"
    | "CAR-BACK"
    | "CAR-FRONT"
    | "CAR-LEFT"
    | "CAR-RIGHT"
    | "ENGINE"
    | "INTERIOR"
    | "OTHER";
}

// Search filters interface
export interface SearchFilters {
  query: string;
  makes?: string[];
  models?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
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
export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  placeholder?: string;
  isLoading?: boolean;
}

export interface VehicleCardProps {
  vehicle: Vehicle;
  onImageClick?: (images: VehicleImage[], index: number) => void;
}
