import { filterMessage } from './anti-circumvention.filter'

describe('chat contact protection', () => {
  it.each([
    'john@example.com', 'john (at) example (dot) com',
    'j*o*h*n @ g*m*a*i*l (.) c*o*m', 'john@gmail.c.o.m',
    'john\u200b@exa\u200bmple.com', 'ｊｏｈｎ＠ｅｘａｍｐｌｅ．ｃｏｍ',
    'john\n@\nexample\n.\ncom', 'john [at] gmail [dot] com',
    '555(.)123(.)4567', '5*5*5*1*2*3*4*5*6*7',
    '555 / 123 / 4567', '555_123_4567', '(555) 123-4567',
    '5$5$5$1$2$3$4$5$6$7', '555$123$4567', '$1234567890', 'john at gmail dot com',
    '5😀5😀5😀1😀2😀3😀4😀5😀6😀7',
    'five * five * five * one * two * three * four * five * six * seven',
    '555\u200b123\u200b4567', '５５５１２３４５６７',
    'john@example.com and 5*5*5*1*2*3*4*5*6*7',
  ])('blocks obfuscated contact: %s', (content) => {
    expect(filterMessage(content)).toMatchObject({ isBlocked: true, sanitized: '[message blocked: contact information]' })
  })

  it.each([
    'The price is $250,000.00 and rehab is $45,500.',
    'ARV $320,000, purchase $185,000, holding $5,000.',
    'Meet at 123 Main St., Austin TX 78701.',
    '26218 US Highway 60, Texas 78701',
    'The kitchen needs 3-4 cabinets. Is 10.5 feet enough?',
    'Close on 09/07/2026 at 10:30 a.m.',
    'The estimate is 1500-2500 dollars.', 'Yes! Great (thanks).',
  ])('allows ordinary real-estate discussion: %s', (content) => {
    expect(filterMessage(content)).toMatchObject({ isBlocked: false, sanitized: content })
  })
})
