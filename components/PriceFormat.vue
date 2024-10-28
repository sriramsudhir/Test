<template>
  <span>{{formattedPrice}}</span>
</template>

<script>

  import {mapGetters} from "vuex"
  import util from "~/mixin/util"
  export default {
    name: 'PriceFormat',
    data() {
      return {

      }
    },
    props: {
      price: {
        default: 0,
        required: true
      }
    },
    mixins: [util],
    components: {},
    computed: {
      formattedPrice(){
        return this.priceFormat(this.currencyPosition, this.currencyIcon, this.price, this.setting)
      },
      ...mapGetters('common', ['currencyIcon', 'setting', 'currencyPosition', 'currency'])
    },
    methods: {

    },
    mounted() {
    }
  }
</script>

