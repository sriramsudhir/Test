<template>
  <div class="area home-section">
    <template v-if="itemList && itemList.length">

      <div class="flex sided title">
        <h4>{{ $t('filter.featured', {title: title}) }}</h4>
        <nuxt-link
          class="link"
          to="/categories"
        >
          {{ $t('featured.showAll') }}
        </nuxt-link>
      </div>

      <div class="area-content">
          <image-slider
            :image-count="itemList.length"
            :per-view="9"
            :gap="15"
            :responsive="[7, 5, 4, 3, 2]"
          >
            <template v-slot:content>
              <li
                v-for="(value, index) in itemList"
                :key="index"
                class="center-text"
              >
                <sub-category-tile
                  :category="value.category"
                  :sub-category="value"
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
  import SubCategoryTile from "./SubCategoryTile";
    export default {
        name: 'Featured',
        data() {
            return {
            }
        },
        watch: {
        },
        props: {
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
          SubCategoryTile,
          ImageSlider,
          LazyImage
        },
        computed: {
        },
        mixins: [util],
        methods: {
        },
        created() {
        },
        mounted() {
        }
    }
</script>

