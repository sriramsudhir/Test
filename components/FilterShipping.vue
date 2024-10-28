<template>
  <div class="sidebar-section">
    <h4 class="title">
      {{ $t('listingLayout.shippingOptions') }}
    </h4>
    <label
      class="block mtb-10"
      v-for="(value, key) in shippingRules"
      :key="key"
      :for="`cb-${value.id}`"
    >
      <input
        :id="`cb-${value.id}`"
        type="checkbox"
        v-model="shipping"
        name="shipping"
        :value="value.id"
        @change="shippingChanged"
      >
      {{ value.title }}
    </label>
  </div>
</template>

<script>


    export default {
      name: "FilterShipping",
      props: {
        shippingRules: {
          type: Array,
          default() {
            return []
          }
        },
      },
      data() {
        return {
          shipping: []
        }
      },
      components: {

      },
      mixins: [],
      computed: {

      },
      mounted() {
        if (this.$route.query.shipping) {
          this.shipping = this.$route.query.shipping.split(',')
        }
      },
      methods: {
        clearShipping() {
          this.shipping = []
        },
        shippingChanged() {
          let filtered = Object.assign({}, this.$route.query)
          if (this.shipping.length) {
            filtered = {...filtered, ...{shipping: this.shipping.join(',')}}
          } else {
            delete filtered.shipping
          }
          this.$emit('reset-route', filtered)
        },
      },
    }
</script>

<style scoped>

</style>
