<template>
  <div
    v-if="(flashSales && flashSales.length) || !flashSales"
  >
      <div
        v-if="!sliderLoaded"
        class="shimmer-wrapper"
      >
        <div
          class="shimmer"
          style="height: 281px"
        />
      </div>

    <div
      class="opacity-0 flash-slider"
      :class="{'opacity-1': sliderLoaded}"
    >
      <div
        v-if="flashSales && flashSales.length"
      >
        <div
          class="area home-section"
          v-for="(flashSale, index) in flashSales"
          :key="index"
        >
          <div class="flex sided title ">
            <div class="flex gap-10">
              <h4>{{ flashSale.title }}</h4>
              <countdown
                :end-time="flashSale.end_time"
              />
            </div>
            <NuxtLink
              class="link"
              :to="`/flash-sale/${flashSale.id}`"
            >
              {{ $t('featured.showAll') }}
            </NuxtLink>
          </div>
          <div
            class="area-content"
          >
            <client-only>


              <image-slider
                v-if="flashSale.public_products && flashSale.public_products.length"
                :image-count="flashSale.public_products.length"
                :per-view="7"
                :gap="20"
                :responsive="[5, 4, 3, 2, 1]"
                @loaded="glideLoaded"
              >
                <template v-slot:content>
                  <li
                    v-for="(value, index) in flashSale.public_products"
                    :key="index"
                    class="center-text"
                  >
                    <flash-product-tile
                      :product="value"
                    />
                  </li>
                </template>
              </image-slider>

            </client-only>



          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script>
  import util from '~/mixin/util'
  import ImageSlider from '~/components/ImageSlider'
  import LazyImage from '~/components/LazyImage'
  import Countdown from '~/components/Countdown'
  import FlashProductTile from "./FlashProductTile";

  export default {
    name: 'FlashSale',
    data() {
      return {
        sliderLoaded: false
      }
    },
    watch: {},
    props: {
      deactivate: {
        type: Boolean,
        default: true,
      },
      flashSales: {
        type: Array,
        default() {
          return []
        }
      }
    },
    components: {
      FlashProductTile,
      ImageSlider,
      LazyImage,
      Countdown
    },
    computed: {
    },
    mixins: [util],
    methods: {
      glideLoaded(){
        this.sliderLoaded = true
      }
    },
    created() {
    },
    mounted() {
    }
  }
</script>
