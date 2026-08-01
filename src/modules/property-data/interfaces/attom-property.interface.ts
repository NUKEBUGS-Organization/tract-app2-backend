// Typing for ATTOM's property/expandedprofile response — ported from App1.
export interface AttomPropertyResponse {
  status?: {
    code?: number
    msg?: string
    total?: number
  }
  property?: AttomProperty[]
}

export interface AttomProperty {
  identifier?: {
    apn?: string
    fips?: string
    attomId?: number
  }
  address?: {
    oneLine?: string
    line1?: string
    line2?: string
    locality?: string
    countrySubd?: string
    postal1?: string
    country?: string
  }
  location?: {
    latitude?: string
    longitude?: string
  }
  summary?: {
    propType?: string
    propertyType?: string
    propSubType?: string
    propClass?: string
    propLandUse?: string
    yearBuilt?: number
    unitsCount?: number
  }
  lot?: {
    lotSize1?: number
    lotSize2?: number
    zoningType?: string
  }
  building?: {
    size?: {
      universalSize?: number
      livingSize?: number
      grossSize?: number
    }
    rooms?: {
      beds?: number
      bathsTotal?: number
      bathsFull?: number
    }
  }
  assessment?: {
    assessed?: {
      assdTtlValue?: number
    }
    market?: {
      mktTtlValue?: number
    }
    tax?: {
      taxAmt?: number
      taxYear?: number
    }
  }
  avm?: {
    amount?: {
      value?: number
    }
  }
  sale?: {
    amount?: {
      saleAmt?: number
    }
    saleSearchDate?: string
  }
}
