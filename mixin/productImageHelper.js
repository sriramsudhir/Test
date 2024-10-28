import {mapGetters, mapActions} from 'vuex'

export default {
  data() {
    return {
    }
  },
  computed:{
    productImage(){
      return this.attrImage || this.product?.image
    },
    attrImage() {
      const images = {}
      const imageData = {}
      this.product?.product_images?.forEach(i => {
        i?.attributes.forEach(j => {
          if (!images[i?.id]) {
            images[i.id] = []
            imageData[i.id] = i?.image
          }
          images[i.id].push(j?.attribute_value_id)
        })
      })

      const attributeValues = this.inventoryAttributes?.map(i => {
        return i?.attribute_value_id
      })

      const matched = this.findBestMatchKey(attributeValues, images)
      return imageData[matched]
    },
  },
  methods: {
    arraySimilarity(arr1, arr2) {
      let similarity = 0;
      for (let item of arr1) {
        if (arr2.includes(item)) {
          similarity++;
        }
      }
      return similarity;
    },
    findBestMatchKey(targetArray, object) {
      let bestMatchKey = null;
      let bestSimilarity = -1;

      for (const key in object) {
        if (Object.hasOwnProperty.call(object, key)) {
          const array = object[key];
          const similarity = this.arraySimilarity(targetArray, array);
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatchKey = key;
          }
        }
      }
      return bestMatchKey;
    },
  }
}
