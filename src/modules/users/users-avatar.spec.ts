import { Model, Types } from 'mongoose'
import { UsersService } from './users.service'
import { UserDocument } from './schemas/user.schema'
import { CloudinaryService } from '../../common/services/cloudinary.service'
import { PasswordHasherService } from '../../common/crypto/password-hasher.service'
import { AuthService } from '../auth/auth.service'

describe('Uploaded profile photo persistence', () => {
  it('stores the upload URL and includes it in profile and session responses', async () => {
    const id = new Types.ObjectId()
    const url = 'https://res.cloudinary.com/example/image/upload/avatar.png'
    const user = { _id: id, avatarUrl: url } as UserDocument
    const findByIdAndUpdate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(user) })
    const uploadImage = jest.fn().mockResolvedValue({ secure_url: url })
    const service = new UsersService(
      { findByIdAndUpdate } as unknown as Model<UserDocument>,
      { uploadImage } as unknown as CloudinaryService,
      {} as PasswordHasherService,
    )
    const uploaded = await service.uploadAvatar(id.toString(), {
      buffer: Buffer.from('mock image'), mimetype: 'image/png', originalname: 'avatar.png', size: 10,
    })
    expect(findByIdAndUpdate).toHaveBeenCalledWith(id.toString(), { $set: { avatarUrl: url } }, { new: true })
    expect(service.toPublicUser(uploaded).avatarUrl).toBe(url)
    expect(AuthService.prototype.sanitizeUser.call({}, uploaded).avatarUrl).toBe(url)
  })
})
