import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { VaultService } from './vault.service'
import { UploadVaultDocDto } from './dto/upload-vault-doc.dto'

@ApiTags('vault')
@ApiBearerAuth('JWT-auth')
@Controller('deals/:dealId/vault')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get()
  @ApiOperation({ summary: 'List vault docs' })
  async list(@Param('dealId') dealId: string, @CurrentUser() user: { _id: { toString(): string }; role: string }) {
    return this.vaultService.listDocuments(dealId, user._id.toString(), user.role)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload vault doc' })
  async upload(
    @Param('dealId') dealId: string,
    @CurrentUser() user: { _id: { toString(): string }; role: string },
    @Body() dto: UploadVaultDocDto,
  ) {
    return this.vaultService.uploadDocument(dealId, user._id.toString(), user.role, dto)
  }

  @Delete(':docId')
  @ApiOperation({ summary: 'Delete vault doc' })
  async delete(
    @Param('dealId') dealId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: { _id: { toString(): string }; role: string },
  ) {
    return this.vaultService.deleteDocument(dealId, docId, user._id.toString(), user.role)
  }
}
