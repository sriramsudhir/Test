import json from '~/config.json'

const apiBase = !process.env.apiBase.trim() ? window.location.origin + '/' : process.env.apiBase

export default {
  data() {
    return {
      shimmerCount: {
        PRODUCT: 21,
        FLASH_SALE: 21
      },
      orderMethods: {
        RAZORPAY: 1,
        CASH_ON_DELIVERY: 2,
        STRIPE: 3,
        PAYPAL: 4,
        FLUTTERWAVE: 5,
        IYZICO_PAYMENT: 6,
        BANK: 7,
        PAYFAST: 8,
      },
      currencyPositionsIn: {
        PRE: 1,
        POST: 2
      },
      orderMethodsIn: {
        1: this.$t('util.creditDebit'),
        2: this.$t('orderTabbing.cod'),
        3: this.$t('util.creditDebit'),
        4: this.$t('util.paypal'),
        5: this.$t('util.flutterwave'),
        6: this.$t('filter.iyzicoPayment'),
        7: this.$t('date.bt'),
        8: this.$t('invent.pf'),
      },
      priceType: {
        FLAT: 1,
        PERCENT: 2
      },
      status: {
        PUBLIC: 1,
        PRIVATE: 2
      },
      shippingTypeIn: {
        location: 1,
        pickup: 2
      },
      paymentStatus: {
        1: this.$t('orderTabbing.paid'),
        0: this.$t('orderTabbing.unPaid')
      },
      paymentStatusIn: {
        PAID: 1,
        UNPAID: 0,
      },
      orderStatus: {
        1: {title: this.$t('util.pending')},
        2: {title: this.$t('util.confirmed')},
        3: {title: this.$t('util.pickedUp')},
        4: {title: this.$t('util.onWay')},
        5: {title: this.$t('util.delivered')}
      },
      orderStatusIn: {
        PENDING: 1,
        CONFIRMED: 2,
        PICKED_UP: 3,
        ON_THE_WAY: 4,
        DELIVERED: 5
      },
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      shippingTypes: {
        1: this.$t('util.location'),
        2: this.$t('util.pickup')
      },
      bannerType: {
        BANNER_1: 1,
        BANNER_2: 2,
        BANNER_3: 3,
        BANNER_4: 4,
        BANNER_5: 5,
        BANNER_6: 6,
        BANNER_7: 7,
        BANNER_8: 8,
        BANNER_9: 9,
      },
      productSources: {
        1: 'categories',
        2: 'sub_categories',
        3: 'tags',
        4: 'brands',
        5: 'products',
        6: 'url'
      },
      productSourcesIn: {
        CATEGORIES: 1,
        SUB_CATEGORIES: 2,
        TAGS: 3,
        BRANDS: 4,
        PRODUCTS: 5,
        URL: 6
      },
      productSourcesValue: {
        1: 'category_ids',
        2: 'sub_category_ids',
        3: 'tags',
        4: 'brand_ids'
      },
      defaultImage: this.$store.state.defaultImage,
      getYear: new Date().getFullYear()
    }
  },
  methods: {
    priceFormat(currencyPosition, currencyIcon, price, setting) {
      if (parseInt(currencyPosition) === this.currencyPositionsIn.PRE) {
        return currencyIcon + this.decimalSeparator(price, setting.decimal_format)
      }
      return this.decimalSeparator(price, setting.decimal_format) + currencyIcon
    },
    decimalSeparator(price, decimalSeparator = 'en-US') {
      if(!decimalSeparator){
        decimalSeparator = 'en-US'
      }

      return parseFloat(price)
        .toLocaleString(
          decimalSeparator,
          {
            maximumFractionDigits: 2,
          })
    },
    getUrl(item) {
      return item?.url || '/'
    },
    getTitle(item) {
      return item?.title || ''
    },
    priceByType(totalPrice, price, type) {
      if (parseInt(type) === this.priceType.FLAT) {
        return price
      } else if (parseInt(type) === this.priceType.PERCENT) {
        return (totalPrice * price) / 100
      }
      return 0
    },
    dataFromObject(data, key, defaultData = '') {
      return data && (data[key] !== undefined) && data[key] ? data[key] : defaultData
    },
    formatPrice(num) {
      return parseFloat(num).toFixed(2)
    },
    hasError(data) {
      let message = data?.message

      if (data?.status === 201) {
        message = data.data?.form[0]
      }

      return this.$nuxt.error({
        statusCode: 400,
        message: message
      })
    },
    capitalize(text) {
      return text.charAt(0).toUpperCase() + text.slice(1);
    },
    slugToText(text) {
      let ser = text.replace('--', '-& ')
      ser = ser.replace('-', ' ')
      ser = ser.replace('-', ' ')
      return this.capitalize(ser)
    },
    convertToSlug(text) {
      return text?.toLowerCase()
        .replace(/ /g, '-')
        .replace(/[^\w-]+/g, '')
    },
    pageLink(page) {
      return `/page/${page.slug}`
    },
    imageURL(obj) {
      return this.getImageURL(obj?.image ? obj?.image : this.defaultImage)
    },
    thumbImageURL(obj) {
      return this.getThumbImageURL(obj?.image ? obj?.image : this.defaultImage)
    },
    getVideoURL(video) {
      return this.$store.state.imgSrcUrl + video
    },
    getImageURL(image = this.defaultImage) {
      return this.$store.state.imgSrcUrl + image
    },
    getThumbImageURL(image = this.defaultImage) {
      return this.$store.state.imgSrcUrl + this.$store.state.thumbPrefix + image
    },
    collectionLink(item) {
      if (item) {
        return `/${item?.slug}/collection?collection=${item?.id}`
      }
    },
    brandLink(item) {
      if (item) {
        return `/${item?.slug}/brand?brand=${item?.id}`
      }
    },
    sourceUrl(item, query = 'home_spm') {
      if (parseInt(item?.source_type) === parseInt(this.productSourcesIn.URL)) {
        return item?.url?.toString() || '/'
      }
      if (item) {
        return `/${item?.slug}/products?${query}=${item.id}`
      }
    },
    listingLink(item) {
      if (item) {
        return `/${item?.slug}/products`
      }
    },
    storeLink(item) {
      if (item) {
        return `/shop/${item?.slug}`
      }
      return ''
    },
    categoryLink(item) {
      if (item) {
        return `/all/${item?.slug}`
      }
    },
    subCategoryLink(item, category) {
      if (item) {
        return `/all/${category?.slug}/${item?.slug}`
      }
    },
    productLink(item) {
      if (item) {
        return `/${item?.slug}/product/${item?.id}`
      }
    },
    socialRedirect(service) {
      return apiBase + json.api.url + json.api.socialLogin + '/' + service
    },
    isMobile() {
      let isMobile = false; //initiate as false
      if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|ipad|iris|kindle|Android|Silk|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(navigator.userAgent)
        || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(navigator.userAgent.substr(0, 4))) {
        isMobile = true;
      }
      return isMobile
    }
  }
}
