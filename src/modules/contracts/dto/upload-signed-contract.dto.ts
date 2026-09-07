import { Equals } from 'class-validator'
import { Transform } from 'class-transformer'

export class UploadSignedContractDto {
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @Equals(true, { message: 'Confirm that you have signed the agreement before uploading it.' })
  buyerSigned: boolean
}
