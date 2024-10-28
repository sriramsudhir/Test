<template>
  <div class="sidebar-section mt-xs-5 mb-xs-10">
    <h4
      class="title">
      {{ $t('listingLayout.price') }}
    </h4>
    <button
      class="clear-btn mb-10"
      aria-label="submit"
      :disabled="!maxPrice && !minPrice"
      @click.prevent="anyPrice"
    >
      {{ $t('listingLayout.anyPrice') }}
    </button>

    <div class="price-search flex">
      <div class="input-wrap">
        <div class="input-text">
          <span>{{ currencyIcon }}</span>
          <input
            type="number"
            :placeholder="$t('listingLayout.min')"
            v-model="minPrice"
          >
        </div>
      </div>

      <div class="input-wrap">
        <div class="input-text">
          <span>{{ currencyIcon }}</span>
          <input
            type="number"
            :placeholder="$t('listingLayout.max')"
            v-model="maxPrice"
          >
        </div>
      </div>

      <button
        class="outline-btn plr-10"
        @click.prevent="filterPrice"
        aria-label="submit"
      >
        {{ $t('listingLayout.go') }}
      </button>
    </div>

  </div><!--sidebar-section-->
</template>

<script>

  import {mapGetters} from 'vuex'

    export default {
      name: "FilterPrice",
      props: {

      },
      data() {
        return {
          minPrice: this.$route.query.min || '',
          maxPrice: this.$route.query.max || '',
        }
      },
      components: {

      },
      mixins: [],
      computed: {
        ...mapGetters('common', ['currencyIcon', 'setting']),
      },
      mounted() {
      },
      methods: {
        anyPrice() {
          this.clearPrice()
          this.filterPrice()
        },
        clearPrice() {
          this.minPrice = ''
          this.maxPrice = ''
        },

        filterPrice() {
          let filtered = Object.assign({}, this.$route.query)
          if (parseInt(this.maxPrice) > 0) {
            filtered = {...filtered, ...{max: this.maxPrice}}
          } else {
            delete filtered.max
          }
          if (parseInt(this.minPrice) > 0) {
            filtered = {...filtered, ...{min: this.minPrice}}
          } else {
            delete filtered.min
          }
          this.$emit('reset-route', filtered)
        },
      },
    }
</script>

<style scoped>

</style>
