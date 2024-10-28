<template>
  <div
    class="main-slider"
    v-if="slider && slider.main.length"
  >
    <div
      class="slider-wrapper"
      :class="{'has-right': rightTop || rightBottom}"
    >
      <div
        class="left flow-hidden"
      >
        <div
          class="pos-rel"
        >
          <client-only>
            <image-slider
              class="opacity-0"
              :class="{'img-loading': imgLoaded}"
              :image-count="slider.main.length"
              :bullets="true"
              :autoplay="6000"
              :loop="true"
              :lazy-image="true"
              @glide="glideSlider"
              @loaded="firstImgLoaded"
              @change="changed"
            >
              <template v-slot:content>
                <li
                  v-for="(value, index) in slider.main"
                  :key="index"
                >
                  <nuxt-link
                    :to="sourceUrl(value)"
                    class="slider-content block"
                  >
                    <div
                      class="slider-content-inner"
                    >
                      <img
                        :id="generateElemId(index)"
                        class="full-dimen"
                        alt="Slider image"
                        :data-source="imageURL(value)"
                        height="100"
                        width="100"
                      >
                    </div>
                  </nuxt-link>
                </li>
              </template>
            </image-slider>
          </client-only>

          <img
            class="full-dimen placeholder-img"
            :class="{'img-loaded': imgLoaded}"
            alt="Slider image"
            height="100"
            width="100"
            :src="imageURL(slider.main[0])"
          >
        </div>

      </div><!--left-->
      <div
        v-if="rightTop || rightBottom"
        class="right"
      >

        <nuxt-link
          v-if="rightTop"
          :to="sourceUrl(slider.right_top)"
          class="img-wrap block"
        >
          <template
            v-if="slider && slider.right_top"
          >
            <img
              :src="imageURL(slider.right_top)"
              height="100"
              width="100"
              alt="Slider image"
            />
          </template>
        </nuxt-link>

        <nuxt-link
          v-if="rightBottom"
          :to="sourceUrl(slider.right_bottom)"
          class="img-wrap block"
        >
          <template
            v-if="slider && slider.right_bottom"
          >
            <img
              :src="imageURL(slider.right_bottom)"
              height="100"
              width="100"
              alt="Slider image"
            />
          </template>
        </nuxt-link>
      </div><!--right-->
    </div><!--main-slider-->
  </div>
  <!--main-slider-->
</template>

<script>
  import util from '~/mixin/util'
  import sliderHelper from '~/mixin/sliderHelper'
  import ImageSlider from '~/components/ImageSlider'
  import LazyImage from '~/components/LazyImage'

  export default {
    name: 'HomeHero',
    data() {
      return {
        imgLoaded: false
      }
    },
    watch: {},
    props: {
      slider: {
        type: Object,
        default() {
          return null
        }
      }
    },
    components: {
      ImageSlider,
      LazyImage
    },
    computed: {
      rightBottom(){
        return this.slider?.right_bottom
      },
      rightTop(){
        return this.slider?.right_top
      }
    },
    mixins: [util, sliderHelper],
    methods: {
    },
    created() {
    },
    mounted() {
    }
  }
</script>



