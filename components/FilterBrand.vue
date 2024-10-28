<template>
  <div class="sidebar-section mt-xs">
    <h4 class="title mb-xs-5">
      {{ $t('listingLayout.brands') }}
    </h4>
    <div class="collapsible" :class="{expanded: brandExpanded}">
      <label
        class="block mtb-10"
        v-for="(value, key) in brands"
        :key="key"
        :for="`brand-${value.id}`"
      >
        <input
          :id="`brand-${value.id}`"
          type="checkbox"
          v-model="brand"
          name="brand"
          :value="value.id"
          @change="brandChanged"
        >
        {{ value.title }}
      </label>
    </div>
    <button
      aria-label="Show/Hide"
      @click.prevent="brandExpanded =! brandExpanded"
      class="link mt-15"
    >
      {{ brandExpanded ? $t('filter.hideAll') : $t('featured.showAll') }}
    </button>
  </div>
</template>

<script>


    export default {
      name: "FilterBrand",
      props: {
        brands: {
          type: Array,
          default() {
            return []
          }
        },
      },
      data() {
        return {
          brand: [],
          brandExpanded: false,
        }
      },
      components: {

      },
      mixins: [],
      computed: {

      },
      mounted() {
        if (this.$route.query.brand) {
          this.brand = this.$route.query.brand.split(',')
          this.$emit('brand-change', this.brand)
        }
      },
      methods: {
        brandChanged() {
          this.$emit('brand-change', this.brand)
          let filtered = Object.assign({}, this.$route.query)
          if (this.brand.length) {
            filtered = {...filtered, ...{brand: this.brand.join(',')}}
          } else {
            delete filtered.brand
          }
          this.$emit('reset-route', filtered)
        },
      },
    }
</script>

<style scoped>

</style>
