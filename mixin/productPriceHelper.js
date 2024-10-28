export default {
  data() {
    return {
    }
  },
  computed: {
    productPrice() {
      if (this.productInventory?.inventory_attributes?.length > 0 && this.productInventory?.price > 0) {
        return this.productInventory?.price
      }
      return this.product.price > 0
        ? this.product.price : this.product.offered > 0
          ? this.product.offered : this.product.selling
    },
    reducedPercent() {
      return 100 - parseInt(((this.currentPricing / this.prevPrice) * 100).toString())
    },
    flashPrice(){
      return this.product?.price !== null ? parseFloat(this.product?.price) : null
    },
    sellPrice(){
      return parseFloat(this.product?.selling || 0)
    },
    offeredPrice(){
      return parseFloat(this.product?.offered || 0)
    },
    prevPrice(){
      return parseFloat(this.offeredPrice > 0 ? this.sellPrice : this.flashPrice ? this.sellPrice : 0)
    },
    currentPricing(){
      return parseFloat(this.flashPrice !== null ? this.flashPrice
        : this.offeredPrice > 0 ? this.offeredPrice
          : this.sellPrice)
    },
    inventoryPrice(){
      //return parseFloat(this.inventory?.price) || 0

      if(this.inventory?.inventory_attributes.length > 0) {
        return parseFloat(this.inventory?.price) || 0
      }
      return 0
    },
    currentInventoryPrice(){
      return parseFloat(this.inventoryPrice > 0 ? this.inventoryPrice : this.currentPricing)
    },
  },
  methods:{
    flashPriceCalc(product){
      return product?.end_time ? product?.price ?? null : null
    },
    sellPriceCalc(product){
      return parseFloat(product?.selling || 0)
    },
    offeredPriceCalc(product){
      return parseFloat(product?.offered || 0)
    },
    currentPricingCalc(product){
      const flashPrice = this.flashPriceCalc(product)

      return flashPrice !== null
        ? flashPrice : this.offeredPriceCalc(product) > 0
          ? this.offeredPriceCalc(product) : parseFloat(product?.selling || 0)
    },
    prevPriceCalc(product){
      return parseFloat(this.offeredPriceCalc(product) > 0 ? this.sellPriceCalc(product)
        : this.flashPriceCalc(product)? this.sellPriceCalc(product) : 0)
    },
    currentInventoryPriceCalc(inventory, product){
      if(inventory?.inventory_attributes?.length > 0) {
        return parseFloat(inventory?.price || 0) > 0 ? (inventory?.price || 0) : this.currentPricingCalc(product)
      }

      return this.currentPricingCalc(product)
    },
  }
}
