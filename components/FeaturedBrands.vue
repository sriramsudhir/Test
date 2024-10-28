<template>
  <div class="area home-section">
    <template v-if="brands && brands.length">

      <div class="flex sided title">
        <h4>{{ $t('filter.featured', {title: title}) }}</h4>
        <nuxt-link
          class="link"
          to="/brands"
        >
          {{ $t('featured.showAll') }}
        </nuxt-link>
      </div>
      <div class="area-content">
          <image-slider
            :image-count="brands.length"
            :per-view="sliderOptions.perView"
            :gap="15"
            :responsive="sliderOptions.responsive"
          >
            <template v-slot:content>
              <li
                v-for="(value, index) in brands"
                :key="index"
                class="center-text"
              >
                <brand-tile
                  v-for="(v, i) in value"
                  :key="i"
                  :brand="v"
                />
              </li>
            </template>
          </image-slider>

      </div>
    </template>
  </div>
</template>

<script>
  import util from '~/mixin/util'
  import ImageSlider from '~/components/ImageSlider'
  import LazyImage from '~/components/LazyImage'
  import CategoryTile from '~/components/CategoryTile'
  import BrandTile from "./BrandTile";
    export default {
        name: 'FeaturedBrands',
        data() {
            return {
              brands: []
            }
        },
        watch: {
        },
        props: {
          type: {
            type: String,
            default: 'brand'
          },
          hasFeaturedBanner: {
            type: Boolean,
            default: false
          },
          title: {
            type: String,
            default: ''
          },
          itemList: {
            type: Array,
            default(){
              return []
            }
          }
        },
        components: {
          BrandTile,
          ImageSlider,
          LazyImage,
          CategoryTile
        },
        computed: {
          sliderOptions(){
            if(this.hasFeaturedBanner){
              return {
                perView: 3,
                responsive: [5, 5, 4, 3, 2]
              }
            }
            return {
              perView: 6,
              responsive: [6, 5, 4, 3, 2]
            }
          },
          isBrand(){
            return this.type === 'brand'
          }
        },
        mixins: [util],
        methods: {
        },
        created() {
        },
        mounted() {
          let items = []
          for(let i in this.itemList){
            items.push(this.itemList[i])
            if(i % 2 === 0){
              items = []
            } else {
              this.brands.push(items)
            }
          }
        }
    }
</script>

