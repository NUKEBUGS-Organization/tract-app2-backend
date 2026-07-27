export interface GoogleAutocompleteResponse {
  status: string
  error_message?: string
  predictions: GoogleAutocompletePrediction[]
}

export interface GoogleAutocompletePrediction {
  place_id: string
  description: string
  structured_formatting?: {
    main_text?: string
    secondary_text?: string
  }
}

export interface GooglePlaceDetailsResponse {
  status: string
  error_message?: string
  result?: {
    formatted_address?: string
    address_components?: GoogleAddressComponent[]
    geometry?: {
      location?: { lat?: number; lng?: number }
    }
  }
}

export interface GoogleAddressComponent {
  long_name: string
  short_name: string
  types: string[]
}
