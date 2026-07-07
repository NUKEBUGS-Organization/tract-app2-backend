require('dotenv').config()
const mongoose = require('mongoose')
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    const count = await mongoose.connection.db
      .collection('faqs')
      .countDocuments()
    console.log('FAQ docs in DB:', count)
    console.log('Connected to:', mongoose.connection.name, 
                 mongoose.connection.host)
    process.exit(0)
  })
  .catch((err) => {
    console.error('Connection failed:', err.message)
    process.exit(1)
  })
