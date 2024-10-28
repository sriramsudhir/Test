<template>
  <div
    :class="{stacked: stackedOnResponsive}"
    class="image-popup-wrapper"
  >
    <pop-over
      v-if="sharePopOver"
      :title="$t('socialShare.share')"
      :layer="true"
      @close="closePopOver"
      elem-id="social-pop-over"
    >
      <template
        v-slot:content
      >
        <social-share
          :product="product"
        />
      </template>
    </pop-over>
    <div
      class="image-popup"
      v-outside-click="closePopup"
    >
      <div
        v-if="stackedOnResponsive"
        class="image-popup-icons"
      >
        <button
          class="left-btn fav-btn"
          @click.prevent="$emit('add-to-wishlist')"
        >
          <i
            :class="isFavourited"
            class="m-0 icon"
          />
        </button>
        <button
          class="right-btn share-btn"
          @click="sharePopOver = !sharePopOver"
        >
          <i
            class="m-0 icon share-icon"
          />
        </button>
      </div>
      <button
        class="right-btn close-btn"
        @click="closePopup"
      >
        <i
          class="m-0 icon close-icon"
        />
      </button>
      <image-slider
        ref="imageSlider"
        :active-slide="activeId"
        :image-count="imageCount"
        :bullets="true"
        :lazy-image="true"
        @glide="glideSlider"
        @change="changed"
        @loaded="firstImgLoaded"
        class="slider-wrapper"
      >
        <template v-slot:bullet-area>
          <div class="thumb-wrapper">
            <h5 class="title mb-10">{{ title }}</h5>
            <div
              data-glide-el="controls[nav]"
              class="flex start wrap"
            >
              <lazy-image
                v-for="(value, index) in imageList"
                :key="index"
                class="img-handler"
                :data-src="getThumbImageURL(value.image)"
                :class="{active: index === currentSlider}"
                :data-glide-dir="`=${index}`"
                height="50"
                width="50"
              />

              <div
                v-if="videoThumb"
                class="img-handler video-thumb"
                :class="{active: imageList.length === currentSlider}"
                :data-glide-dir="`=${imageList.length}`"
              >



                <lazy-image
                  :data-src="getImageURL(videoThumb)"
                  height="50"
                  width="50"
                />
                <span class="flex">
                   <i
                     class="icon play-icon"
                   />
                </span>
              </div>
            </div>
          </div>
        </template>
        <template v-slot:content>
          <li
            v-for="(value, index) in imageList"
            :key="index"
          >
            <div class="slider-content">
              <div
                class="slider-content-inner"
              >
                <img
                  :id="generateElemId(index)"
                  class="full-dimen opacity-0"
                  :data-source="getImageURL(value.image)"
                  alt="Product image"
                  height="100"
                  width="100"
                />
              </div>
            </div>
          </li>


          <li
            v-if="video"
          >
            <div class="slider-content">
              <div class="slider-content-inner">
                <video
                  controls=""
                  :autostart="0"
                >
                  <source
                    :src="getVideoURL(video)"
                    type="video/mp4"
                  >
                </video>
              </div>
            </div>
          </li>
        </template>
      </image-slider>
    </div>
  </div>
</template>

<script>
  import sliderHelper from '~/mixin/sliderHelper'
  import outsideClick from '~/directives/outside-click'
  import ImageSlider from '~/components/ImageSlider'
  import LazyImage from '~/components/LazyImage'
  import SocialShare from '~/components/SocialShare'
  import PopOver from '~/components/PopOver'
  import util from '~/mixin/util'
  export default {
    name: 'ImagePopup',
    data() {
      return {
        sharePopOver: false,
        scrollPosition: 0
      }
    },
    components: {
      ImageSlider,
      LazyImage,
      SocialShare,
      PopOver
    },
    directives: {outsideClick},
    mixins: [util, sliderHelper],
    props: {
      product: {
        type: Object
      },
      title: {
        type: String,
        default: ''
      },
      activeId: {
        type: Number,
        default: 1
      },
      imageList: {
        type: Array,
        default() {
          return []
        }
      },
      noScroll: {
        type: Boolean,
        default: true
      },
      stackedOnResponsive: {
        type: Boolean,
        default: false
      },
    },
    computed: {
      imageCount(){
        if(this.video) {
          return this.imageList.length + 1
        }
        return this.imageList.length
      },
      video(){
        return this.product?.video || ''
      },
      videoThumb(){
        return this.product?.video_thumb || ''
      },
      wishListed(){
        return this.$auth?.user?.id && this.product?.wishlisted
      },
      isFavourited(){
        return this.wishListed ? 'heart-fill-icon' : 'heart-icon'
      }
    },
    methods: {
      clickOnThumb(index){
        this.$refs?.imageSlider?.changeSlide(index)
      },
      closePopOver(){
        this.sharePopOver = false
      },
      closePopup(){
        this.$emit('close-popup')
      }
    },
    mounted() {
      if(this.noScroll){
        document.body.classList.add('no-scroll')
      }
    },
    destroyed() {
      document.body.classList.remove('no-scroll')
    }
  }
</script>
