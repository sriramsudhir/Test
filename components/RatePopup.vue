<template>
  <pop-over
    :title="$t('filter.rating')"
    @close="$emit('close')"
    elem-id="rate-pop-over"
    :layer="true"
    class="rating-popup popup-top-auto"
  >
    <template v-slot:content>
      <div
        v-if="fetchingRatingData"
        class="mn-h-200x flex"
      >
        <spinner
          :radius="70"
        />
      </div>
      <div
        v-else
      >
        <div class="mb-15 flex sided">
          <span
            class="star-wrapper"
            @mouseleave="mouseLeaveFn"
          >
            <span class="star-btn">
              <span
                v-for="val in 5"
                @mouseover="mouseEnterFn(val)"
                @click="rated(val)"
              >
                ☆
              </span>
            </span>
            <span
              class="star-fill"
              :style="{width: `${ratingComputed * 20}%`}"
            >
              <span
                v-for="val in ratingComputed"
                @mouseover="mouseEnterFn(val)"
                @click="rated(val)"
              >
                ★
              </span>
            </span>
          </span>
          <input
            class="d-none"
            type="file"
            multiple
            @change="addImage"
            ref="fileInput"
          >
          <button
            aria-label="submit"
            class="outline-btn plr-20"
            @click="$refs.fileInput.click()"
          >
            {{ $t('ratePopup.addImage') }}
          </button>
        </div>

        <p class="mb-15 f-9">
          {{ $t('ratePopup.supportedImage', { max: maxSize}) }}
        </p>

        <div
          v-if="imageFiles.length"
          class="flex m--7-5 start wrap mb-10"
        >
          <div
            class="img-container"
            v-for="(val, index) in imageFiles"
          >
            <button
              aria-label="close"
              class="close-btn"
              @click="deleteImg(index)"
            >
              <i
                class="icon close-icon"
              />
            </button>
            <div class="b-dashed m-7-5 img-wrapper">
              <img
                :src="val.url"
                height="20"
                width="20"
              >
            </div>
          </div>
        </div>
        <textarea
          v-model="review"
        />
      </div>
    </template>
    <template v-slot:pop-footer>
      <div class="flex j-end gap-10">
        <button
          aria-label="submit"
          class="outline-btn plr-30 plr-sm-15"
          @click.prevent="$emit('close')"
        >
          {{ $t('addressPopup.cancel') }}
        </button>
        <ajax-button
          class="primary-btn  plr-30 plr-sm-15"
          type="button"
          :fetching-data="submitting"
          :loading-text="$t('checkoutRight.submitting')"
          :text="$t('ratePopup.rateNow')"
          :disabled="fetchingRatingData"
          @clicked="submitRating"
        />
      </div>
    </template>
  </pop-over>

</template>

<script>
  import util from '~/mixin/util'
  import validation from '~/mixin/validation'
  import PopOver from '~/components/PopOver'
  import Spinner from '~/components/Spinner'
  import {mapGetters, mapActions} from 'vuex'
  import AjaxButton from "~/components/AjaxButton";

  export default {
    name: 'RatePopup',
    data() {
      return {
        hoverRating: 0,
        id: 0,
        rating: 0,
        images: [],
        imageFiles: [],
        deletedImages: [],
        review: '',
        submitting: false,
        hasImageError: false,
        fetchingRatingData: false
      }
    },
    watch: {},
    props: {
      orderId: {
        type: Number,
        required: true
      },
      productId: {
        type: Number,
        required: true
      }
    },
    components: {
      AjaxButton,
      PopOver,
      Spinner
    },
    computed: {
      ratingComputed() {
        return this.hoverRating || this.rating
      },
      ...mapGetters('language', ['langCode']),
    },
    mixins: [util, validation],
    methods: {
      serializing(obj) {
        this.rating = parseInt(obj.rating)
        this.review = obj.review
        this.id = obj.id
        obj.review_images.forEach(img => {
          this.images.push({
            id: img.id,
            image: img.image
          })
          this.imageFiles.push({
            id: img.id,
            url: this.getThumbImageURL(img.image),
            image: img.image
          })
        })
      },
      deleteImg(index) {
        if (this.imageFiles[index].id) {
          this.deletedImages.push({
            id: this.imageFiles[index].id,
            image: this.imageFiles[index].image
          })
        }

        this.images.splice(index, 1)
        this.imageFiles.splice(index, 1)
      },
      addImage(evt) {

        this.hasImageError = false

        Object.values(evt.target.files).forEach((obj) => {

          if (this.imageFile(obj)) {
            this.imageFiles.push({
              id: '',
              url: URL.createObjectURL(obj)
            })
            this.images.push({
              id: '',
              image: obj
            })
          } else {
            this.hasImageError = true
          }
        })

        if (this.hasImageError) {
          this.setToastError(this.$t('ratePopup.uploadingError'))
        }
      },
      mouseEnterFn(val) {
        this.hoverRating = val
      },
      mouseLeaveFn() {
        this.hoverRating = 0
      },
      rated(val) {
        this.rating = val
      },
      async submitRating() {
        const fdImg = new FormData()
        this.images.forEach(obj => {
          if (!obj.id) {
            fdImg.append('images[]', obj.image)
          }
        })
        fdImg.append('user_token', await this.getUserToken())
        fdImg.append('order_id', this.orderId)
        fdImg.append('product_id', this.productId)
        fdImg.append('rating', this.rating)
        fdImg.append('review', this.review)
        fdImg.append('deleted_images', JSON.stringify(this.deletedImages))
        fdImg.append('id', this.id)

        this.submitting = true
        const data = await this.ratingReviewAction({
          payload: fdImg,
          lang: this.langCode
        })
        this.submitting = false

        if (data?.status === 200) {
          this.$emit('close')
          this.setToastMessage(data.message)
        } else {
          this.setToastError(data.data.form.join(', '))
        }
      },
      ...mapActions('user', ['getUserToken']),
      ...mapActions('common', ['setToastMessage', 'setToastError']),
      ...mapActions('order', ['ratingReviewAction', 'ratingReviewFind']),
    },
    async mounted() {
      this.fetchingRatingData = true
      const data = await this.ratingReviewFind({
        lang: this.langCode,
        payload: {
          id: this.productId,
          user_token: await this.getUserToken(),
        }
      })
      if (data?.status === 200) {
        this.serializing(data.data)
      }
      this.fetchingRatingData = false
    }
  }
</script>

